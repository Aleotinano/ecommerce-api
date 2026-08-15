// Compila ./menu.json al ./catalogo.json que consumen los seeds.
//   node prisma/pastaia/build-menu.js
//
// A diferencia de punto-healthy/build-menu.js, que reorganiza la transcripción de una
// carta impresa, acá menu.json es una MATRIZ y este archivo la EXPANDE:
//
//   formatos (3) x rellenos (4)   -> 12 productos
//   masas (3)    x cajas (3)      ->  9 variantes por producto
//   + las salsas, que son producto aparte (una variante cada una)
//
// Por qué la salsa no es un tercer eje de variante ni un combo: como eje daría 324
// variantes, y como combo el cliente podría meter la caja x48 en el combo de x12
// (`ComboAllowedProduct` apunta a un Product, no a una ProductVariant — la brecha
// abierta que documenta [[punto-healthy]]).
//
// Lo que decide este archivo y menu.json no dice: `position` de cada categoría, los
// SKUs, el stock inicial y el redondeo de los precios calculados.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "menu.json");
const OUTPUT = join(HERE, "catalogo.json");

// Prefijo de SKU del tenant, igual que "PH-" en punto-healthy y "MK-" en maikai.
const SKU_PREFIX = "PA";

// Stock inicial de cada variante NUEVA. Pastaia va en modo SHOP y con stock 0 no se
// podría comprar nada. 999 es explícitamente "no llevo control por variante": son 108
// variantes de pasta y un freezer no se lleva bien con 108 contadores separados. El
// seed NUNCA lo vuelve a pisar en corridas siguientes (ver productos.js).
const STOCK_INICIAL = 999;

// Los precios calculados se redondean a la centena: la suma de un recargo por unidad
// da números como $23.640 que nadie pone en una lista de precios.
const REDONDEO = 100;

// Tope de `description` en schemas/product.schema.js. Se chequea acá para que el
// catálogo no se cargue con textos que después el admin no pueda guardar.
const DESCRIPCION_MAX = 600;

const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

const slug = (s) =>
  sinTildes(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function buildSku(partes, taken) {
  const base = `${SKU_PREFIX}-${partes.map(slug).join("-")}`.slice(0, 60);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  taken.add(`${base}-${n}`);
  return `${base}-${n}`;
}

// Las claves que empiezan con "_" son notas para quien edita menu.json, no datos.
const sinNotas = (obj) =>
  Object.fromEntries(Object.entries(obj ?? {}).filter(([key]) => !key.startsWith("_")));

const redondear = (n) => Math.round(n / REDONDEO) * REDONDEO;

const pesos = (n) => `$${n.toLocaleString("es-AR")}`;

/**
 * precio = base(formato, caja)
 *        + recargoMasa    * unidades  (si la masa no es la que no lleva recargo)
 *        + recargoRelleno * unidades  (si ese relleno tiene sobreprecio)
 *
 * Acumula en `faltantes` en vez de tirar en el primer null, para que el error final
 * liste TODO lo que hay que completar de una y no de a un dato por corrida.
 */
function resolvePrecio({ precios, formato, relleno, masa, caja, faltantes }) {
  const base = precios.base?.[formato]?.[caja.label];
  if (base == null) {
    faltantes.add(`precios.base["${formato}"]["${caja.label}"]`);
  }

  let recargoMasa = 0;
  if (masa !== precios.masaSinRecargo) {
    if (precios.recargoMasaPorUnidad == null) {
      faltantes.add("precios.recargoMasaPorUnidad");
    } else {
      recargoMasa = precios.recargoMasaPorUnidad * caja.unidades;
    }
  }

  const recargoRelleno = (sinNotas(precios.recargoRellenoPorUnidad)[relleno] ?? 0) * caja.unidades;

  if (base == null) return null;
  return redondear(base + recargoMasa + recargoRelleno);
}

function buildCategorias(menu) {
  // Las 4 son raíces hoja: con 3-4 productos cada una un segundo nivel no aporta nada,
  // y `Categories` tiene @@unique([tenantId, name]) GLOBAL, no por padre.
  const categorias = [...menu.formatos, menu.salsas.categoria].map((spec, position) => ({
    name: spec.name,
    parent: null,
    position,
    icon: spec.icon,
    description: spec.description ?? null,
  }));

  for (const categoria of categorias) {
    if (!categoria.icon) {
      throw new Error(`Falta el ícono de la categoría "${categoria.name}" en menu.json.`);
    }
  }

  return categorias;
}

function buildProductos(menu, taken, faltantes) {
  const productos = [];

  for (const formato of menu.formatos) {
    for (const relleno of menu.rellenos) {
      const name = `${formato.name} de ${relleno}`;
      const description = menu.descripcionTemplate
        .replace("{formato}", formato.name)
        .replace("{relleno}", relleno);

      if (description.length > DESCRIPCION_MAX) {
        throw new Error(
          `La descripción de "${name}" mide ${description.length} caracteres y el máximo es ${DESCRIPCION_MAX} (schemas/product.schema.js).`
        );
      }

      const variants = [];
      for (const masa of menu.masas) {
        for (const caja of menu.cajas) {
          variants.push({
            sku: buildSku([name, masa, `x${caja.unidades}`], taken),
            attributes: { masa, caja: caja.label },
            price: resolvePrecio({
              precios: menu.precios,
              formato: formato.name,
              relleno,
              masa,
              caja,
              faltantes,
            }),
            stock: STOCK_INICIAL,
            // La default es la primera: masa Clásica en la caja más chica, la opción
            // de entrada. Mismo criterio que punto-healthy.
            isDefault: variants.length === 0,
          });
        }
      }

      productos.push({ name, category: formato.name, description, variants });
    }
  }

  for (const salsa of menu.salsas.productos) {
    if (salsa.price == null) faltantes.add(`salsas.productos["${salsa.name}"].price`);
    productos.push({
      name: salsa.name,
      category: menu.salsas.categoria.name,
      description: salsa.description ?? null,
      // Una sola variante y `attributes: {}`: la salsa no tiene ejes de elección.
      variants: [
        {
          sku: buildSku([salsa.name], taken),
          attributes: {},
          price: salsa.price,
          stock: STOCK_INICIAL,
          isDefault: true,
        },
      ],
    });
  }

  return productos;
}

function validarRellenosDeRecargos(menu) {
  const conocidos = new Set(menu.rellenos);
  for (const relleno of Object.keys(sinNotas(menu.precios.recargoRellenoPorUnidad))) {
    if (!conocidos.has(relleno)) {
      throw new Error(
        `precios.recargoRellenoPorUnidad tiene "${relleno}", que no está en la lista de rellenos. ` +
          `Rellenos válidos: ${menu.rellenos.join(", ")}.`
      );
    }
  }
}

function imprimirGrilla(menu, productos) {
  console.log("");
  console.log("  Grilla de precios");
  const anchoMasa = Math.max(...menu.masas.map((m) => m.length)) + 2;

  for (const producto of productos) {
    if (producto.variants.length === 1) continue;
    console.log(`    ${producto.name}`);
    for (const masa of menu.masas) {
      const fila = menu.cajas
        .map((caja) => {
          const v = producto.variants.find(
            (x) => x.attributes.masa === masa && x.attributes.caja === caja.label
          );
          return pesos(v.price).padStart(11);
        })
        .join("");
      console.log(`      ${masa.padEnd(anchoMasa)}${fila}`);
    }
  }

  const salsas = productos.filter((p) => p.variants.length === 1);
  if (salsas.length) {
    console.log("    Salsas");
    for (const salsa of salsas) {
      console.log(`      ${salsa.name.padEnd(anchoMasa + 22)}${pesos(salsa.variants[0].price).padStart(11)}`);
    }
  }
}

function main() {
  const menu = JSON.parse(readFileSync(SOURCE, "utf8"));

  validarRellenosDeRecargos(menu);

  const taken = new Set();
  const faltantes = new Set();

  const categorias = buildCategorias(menu);
  const productos = buildProductos(menu, taken, faltantes);

  if (faltantes.size) {
    throw new Error(
      `Faltan ${faltantes.size} datos de precio en menu.json. No se escribe catalogo.json:\n` +
        [...faltantes]
          .sort()
          .map((f) => `  - ${f}`)
          .join("\n") +
        "\n\nSon datos de negocio: no se inventan (docs/servicios/Tenants/new-tenant-config.md §6)."
    );
  }

  writeFileSync(OUTPUT, `${JSON.stringify({ categorias, productos }, null, 2)}\n`, "utf8");

  const variantes = productos.reduce((sum, p) => sum + p.variants.length, 0);
  const pastas = productos.filter((p) => p.variants.length > 1);
  const salsas = productos.length - pastas.length;

  console.log("catalogo.json escrito desde menu.json");
  console.log(`  ${categorias.length} categorías, todas raíces hoja`);
  console.log(
    `  ${productos.length} productos: ${pastas.length} de pasta (${menu.formatos.length} formatos x ${menu.rellenos.length} rellenos) + ${salsas} salsas`
  );
  console.log(
    `  ${variantes} variantes: ${pastas.length} x ${menu.masas.length} masas x ${menu.cajas.length} cajas + ${salsas}`
  );
  console.log(`  stock inicial ${STOCK_INICIAL} por variante (solo al crear)`);

  imprimirGrilla(menu, productos);
}

main();
