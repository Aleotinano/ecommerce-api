// Compila ./menu.json (la transcripción de la carta, copiada tal cual del repo del
// front: scripts/seed-catalog/data/punto-healthy.menu.json) al ./catalogo.json que
// consumen los seeds.
//   node prisma/punto-healthy/build-menu.js
//
// menu.json NO se edita a mano acá: es la fuente compartida con el front y se
// re-copia cuando cambia la carta. Todo lo que el modelo necesita y la carta no dice
// —orden e íconos de categoría, SKUs, cómo se expresa cada combo— se decide en ESTE
// archivo, que es el único lugar donde hay que mirar cuando algo del catálogo no
// cierra.
//
// Lo que hace, en orden:
//   1. Categorías: les pone `position` (orden del array, por nivel) e `icon`.
//   2. Productos: arma el SKU, concatena la ficha nutricional a la descripción y
//      expande `variants` (un producto con N presentaciones/sabores = N variantes,
//      la primera es la default).
//   3. Combos: traduce `items`/`groups` a la whitelist real del backend, eligiendo
//      entre los dos patrones que soporta (ver `planCombo`).
//   4. Valida que toda referencia exista, y falla fuerte si no.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "menu.json");
const OUTPUT = join(HERE, "catalogo.json");

// Prefijo de SKU del tenant, igual que "MK-" en maikai.
const SKU_PREFIX = "PH";

// Stock inicial de cada variante NUEVA. Punto Healthy va en modo SHOP: con stock 0 no
// se podría comprar nada (a diferencia de maikai, que es carta y ahí el stock no
// gobierna). 100 es un número de arranque plausible que el local corrige desde el
// panel — y el seed NUNCA lo vuelve a pisar en corridas siguientes (ver productos.js).
const STOCK_INICIAL = 100;

// Íconos lucide por categoría. La carta no los trae; se eligen acá para que el grid
// del storefront no quede sin ícono.
const ICONOS = {
  "Protein Bowls": "salad",
  Smoothies: "blend",
  "Protein Snacks": "cookie",
  Bebidas: "cup-soda",
  "Bebidas calientes": "coffee",
  "Bebidas frías": "glass-water",
  Promos: "percent",
  "Promos individuales": "user",
  "Promos para compartir": "users",
  "Promos para llevar": "shopping-bag",
};

// Nombre del atributo en la carta -> key del catálogo de atributos del tenant
// (TenantAttribute, ver ./atributos.js). Las keys son slugs estables sin tildes.
const ATRIBUTOS = {
  "Presentación": "presentacion",
  Sabor: "sabor",
};

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

// La ficha nutricional (la línea amarilla de la carta) no tiene campo propio en el
// modelo, así que va al final de la descripción. `nutritionScope: "unidad"` es el
// "VALORES POR UNIDAD" de la carta: sin esa aclaración, los macros de una cookie se
// leerían como los del pack de 12.
function buildDescripcion(spec) {
  const partes = [];
  if (spec.description) partes.push(spec.description);
  if (spec.nutrition) {
    const prefijo = spec.nutritionScope === "unidad" ? "VALORES POR UNIDAD — " : "";
    partes.push(`${prefijo}${spec.nutrition}`);
  }
  return partes.join("\n\n") || null;
}

function buildCategorias(categories) {
  const positions = new Map();
  return categories.map((category) => {
    const scope = category.parent ?? "__root__";
    const position = positions.get(scope) ?? 0;
    positions.set(scope, position + 1);

    const icon = ICONOS[category.name];
    if (!icon) throw new Error(`Falta el ícono de la categoría "${category.name}" en ICONOS.`);

    return {
      name: category.name,
      parent: category.parent ?? null,
      position,
      icon,
      description: category.description ?? null,
    };
  });
}

function buildProductos(products) {
  const taken = new Set();
  const nombres = new Set();

  return products.map((spec) => {
    if (nombres.has(spec.name)) {
      throw new Error(
        `Producto duplicado: "${spec.name}". Los nombres tienen que ser únicos (la carta repite "Detox Deluxe", por eso en menu.json están desambiguados).`
      );
    }
    nombres.add(spec.name);

    const description = buildDescripcion(spec);
    if (description && description.length > DESCRIPCION_MAX) {
      throw new Error(
        `La descripción de "${spec.name}" mide ${description.length} caracteres y el máximo es ${DESCRIPCION_MAX} (schemas/product.schema.js).`
      );
    }

    const tieneVariantes = Array.isArray(spec.variants) && spec.variants.length > 0;
    if (tieneVariantes === (spec.price !== undefined)) {
      throw new Error(`"${spec.name}" tiene que traer price O variants, nunca los dos ni ninguno.`);
    }

    // Un producto sin ejes de elección igual lleva UNA variante: en un PRODUCTO el
    // precio vive siempre en la variante `isDefault`, nunca en Product.price.
    const variants = tieneVariantes
      ? spec.variants.map((variant, index) => {
          const key = ATRIBUTOS[spec.variantAttribute];
          if (!key) {
            throw new Error(
              `"${spec.name}" declara variantAttribute "${spec.variantAttribute}", que no está en ATRIBUTOS.`
            );
          }
          return {
            sku: buildSku([spec.name, variant.name], taken),
            attributes: { [key]: variant.name },
            price: variant.price,
            stock: STOCK_INICIAL,
            isDefault: index === 0,
            nombre: variant.name,
            // Alguna variante trae descripción propia (el pack x6 del Detox); hoy el
            // modelo no tiene dónde ponerla y se pierde — sale en el resumen.
            descripcionPropia: variant.description ?? null,
          };
        })
      : [
          {
            sku: buildSku([spec.name], taken),
            attributes: {},
            price: spec.price,
            stock: STOCK_INICIAL,
            isDefault: true,
            nombre: null,
            descripcionPropia: null,
          },
        ];

    return {
      name: spec.name,
      category: spec.category,
      description,
      variantAttribute: tieneVariantes ? ATRIBUTOS[spec.variantAttribute] : null,
      variants,
    };
  });
}

/**
 * Traduce los `items` (contenido fijo) y `groups` (elegí N entre estos) de un combo a
 * la whitelist que el backend sabe validar. Los dos se expresan igual —un grupo con
 * una cantidad exacta—; la diferencia es cuántos productos hay para elegir.
 *
 * El backend ofrece dos formas de whitelist y NO se pueden mezclar en un mismo combo:
 * si hay reglas de categoría, `comboMinItems`/`comboMaxItems` se derivan de ellas e
 * ignoran las standalone (`deriveComboRange`, services/productos.js), así que el total
 * quedaría mal y no entraría ninguna selección. Por eso se elige una sola:
 *
 * - CATEGORIAS (`comboCategoryOptions`): cuando cada grupo cae entero dentro de una
 *   categoría y no hay dos grupos en la misma. Es el patrón preferido porque el mínimo
 *   de cada grupo se exige SIEMPRE, aunque el cliente no elija nada de ahí: el combo
 *   sale exacto o no sale.
 * - STANDALONE (`comboOptions` + min/max explícitos): todo lo demás. Un grupo que cruza
 *   dos categorías (las "bebidas funcionales" están en calientes y frías) o dos grupos
 *   de la misma categoría no son expresables por categoría — `ComboAllowedCategory`
 *   tiene @@unique(comboProductId, categoryId). Contrapartida: el `minQty` de una regla
 *   standalone solo se valida si el producto está en la selección, así que lo único que
 *   obliga es el total del combo, y el cliente puede cambiar un ítem fijo por otra
 *   unidad del grupo. Los combos donde eso pasa salen listados en el resumen.
 */
function planCombo(combo, categoriaPorProducto) {
  const grupos = [];

  for (const item of combo.items ?? []) {
    grupos.push({
      label: item.product,
      qty: item.qty ?? 1,
      fijo: true,
      categoriaEntera: null,
      productos: [{ product: item.product, variant: item.variant ?? null }],
    });
  }

  for (const group of combo.groups ?? []) {
    grupos.push({
      label: group.label ?? group.selection ?? group.category,
      qty: group.qty,
      fijo: false,
      // Un grupo apunta a productos explícitos, a una `selection` compartida (ya
      // resuelta a productos por el caller) o a una categoría entera. La categoría
      // entera se deja abierta a propósito: entran también los productos futuros.
      categoriaEntera: group.category ?? null,
      productos: (group.products ?? []).map((p) =>
        typeof p === "string"
          ? { product: p, variant: null }
          : { product: p.product, variant: p.variant ?? null }
      ),
    });
  }

  const total = grupos.reduce((sum, g) => sum + g.qty, 0);

  // ¿Sirve el patrón por categorías? Cada grupo tiene que caer en UNA categoría, y dos
  // grupos no pueden compartirla.
  const categoriasUsadas = new Set();
  let porCategorias = grupos.length > 0;
  for (const grupo of grupos) {
    const categorias = grupo.categoriaEntera
      ? new Set([grupo.categoriaEntera])
      : new Set(grupo.productos.map((p) => categoriaPorProducto.get(p.product)));
    if (categorias.size !== 1) {
      porCategorias = false;
      break;
    }
    const [categoria] = categorias;
    if (categoriasUsadas.has(categoria)) {
      porCategorias = false;
      break;
    }
    categoriasUsadas.add(categoria);
    grupo.categoria = categoria;
  }

  if (porCategorias) {
    return {
      patron: "categorias",
      comboMinItems: total,
      comboMaxItems: total,
      categoryOptions: grupos.map((grupo) => ({
        category: grupo.categoria,
        minQty: grupo.qty,
        maxQty: grupo.qty,
        // Sin miembros = toda la categoría (incluidos los productos que se agreguen
        // después). Con miembros = lista cerrada.
        products: grupo.categoriaEntera ? [] : grupo.productos.map((p) => p.product),
      })),
      grupos,
    };
  }

  // Standalone: un producto no puede repetirse entre grupos (@@unique del modelo).
  const vistos = new Set();
  const options = [];
  for (const grupo of grupos) {
    for (const { product } of grupo.productos) {
      if (vistos.has(product)) {
        throw new Error(
          `El combo "${combo.name}" usa "${product}" en dos grupos distintos y la whitelist no lo permite (@@unique comboProductId+allowedProductId).`
        );
      }
      vistos.add(product);
      options.push({
        product,
        // Ítem fijo: cantidad exacta. Opción de un grupo: hasta la cantidad del grupo,
        // que es lo que habilita elegir N packs iguales (el "también podés elegir 24
        // unidades iguales" del Combo 3).
        minQty: grupo.fijo ? grupo.qty : 0,
        maxQty: grupo.qty,
      });
    }
  }

  return { patron: "standalone", comboMinItems: total, comboMaxItems: total, options, grupos };
}

function main() {
  const menu = JSON.parse(readFileSync(SOURCE, "utf8"));

  const categorias = buildCategorias(menu.categories);
  const nombresCategoria = new Set(categorias.map((c) => c.name));

  const productos = buildProductos(menu.products);
  const categoriaPorProducto = new Map(productos.map((p) => [p.name, p.category]));
  const variantesPorProducto = new Map(
    productos.map((p) => [p.name, new Set(p.variants.map((v) => v.nombre).filter(Boolean))])
  );

  for (const producto of productos) {
    if (!nombresCategoria.has(producto.category)) {
      throw new Error(
        `"${producto.name}" apunta a la categoría "${producto.category}", que no existe.`
      );
    }
  }

  // Referencias sueltas dentro de un combo: un producto que no existe, o una variante
  // que ese producto no tiene. Es el chequeo que evita cargar un combo roto.
  const chequearRef = (contexto, product, variant) => {
    if (!categoriaPorProducto.has(product)) {
      throw new Error(`${contexto} referencia el producto "${product}", que no está en el menú.`);
    }
    if (variant && !variantesPorProducto.get(product).has(variant)) {
      throw new Error(
        `${contexto} referencia "${product}" / "${variant}", que no es una variante de ese producto.`
      );
    }
  };

  const combos = menu.combos.map((combo) => {
    // Las `selections` viven aparte para no repetir 14 nombres en cada promo.
    const groups = (combo.groups ?? []).map((group) => {
      if (!group.selection) return group;
      const selection = menu.selections[group.selection];
      if (!selection) {
        throw new Error(
          `El combo "${combo.name}" usa la selección "${group.selection}", que no está definida.`
        );
      }
      return { ...group, label: group.label ?? selection.label, products: selection.products };
    });

    const resuelto = { ...combo, groups };

    for (const item of resuelto.items ?? []) {
      chequearRef(`El combo "${combo.name}"`, item.product, item.variant);
    }
    for (const group of groups) {
      if (group.category && !nombresCategoria.has(group.category)) {
        throw new Error(
          `El combo "${combo.name}" apunta a la categoría "${group.category}", que no existe.`
        );
      }
      for (const p of group.products ?? []) {
        const product = typeof p === "string" ? p : p.product;
        const variant = typeof p === "string" ? null : p.variant;
        chequearRef(`El combo "${combo.name}"`, product, variant);
      }
    }

    if (!nombresCategoria.has(combo.category)) {
      throw new Error(
        `El combo "${combo.name}" apunta a la categoría "${combo.category}", que no existe.`
      );
    }

    const plan = planCombo(resuelto, categoriaPorProducto);

    return {
      name: combo.name,
      category: combo.category,
      description: combo.description ?? null,
      price: combo.price,
      // El "AHORRÁ $X" impreso se guarda como precio de lista: el ahorro que muestra el
      // storefront es `compareAtPrice - price`. Ver Product.compareAtPrice.
      compareAtPrice: combo.savings != null ? combo.price + combo.savings : null,
      savings: combo.savings ?? null,
      patron: plan.patron,
      comboMinItems: plan.comboMinItems,
      comboMaxItems: plan.comboMaxItems,
      categoryOptions: plan.categoryOptions ?? null,
      options: plan.options ?? null,
      // Se guarda para el resumen y para la doc: es una de las dos cosas que el modelo
      // no representa hoy (ver docs/servicios/Tenants/punto-healthy.md).
      variantesReferenciadas: [
        ...(combo.items ?? []).filter((i) => i.variant).map((i) => `${i.product} / ${i.variant}`),
        ...groups.flatMap((g) =>
          (g.products ?? [])
            .filter((p) => typeof p !== "string" && p.variant)
            .map((p) => `${p.product} / ${p.variant}`)
        ),
      ],
    };
  });

  writeFileSync(OUTPUT, `${JSON.stringify({ categorias, productos, combos }, null, 2)}\n`, "utf8");

  // --- Resumen: es la verificación del script -------------------------------
  const variantes = productos.reduce((sum, p) => sum + p.variants.length, 0);
  const raices = categorias.filter((c) => !c.parent).length;
  const multiVariante = productos.filter((p) => p.variants.length > 1).length;

  console.log("catalogo.json escrito desde menu.json");
  console.log(`  ${categorias.length} categorías (${raices} raíces)`);
  console.log(`  ${productos.length} productos, ${variantes} variantes (${multiVariante} con más de una)`);
  console.log(
    `  ${combos.length} combos: ${combos.filter((c) => c.patron === "categorias").length} por categoría, ${combos.filter((c) => c.patron === "standalone").length} standalone`
  );
  console.log(`  ${combos.filter((c) => c.compareAtPrice != null).length} combos con precio de lista (el "AHORRÁ" impreso)`);

  // Combos donde el cliente puede desbalancear la selección: standalone con un ítem
  // fijo y algún grupo con más de una opción (el mínimo del ítem fijo no se exige si el
  // producto no está en la selección).
  const desbalanceables = combos.filter(
    (c) =>
      c.patron === "standalone" &&
      c.options.some((o) => o.minQty > 0) &&
      c.options.some((o) => o.minQty === 0)
  );
  if (desbalanceables.length) {
    console.log(`  ⚠️  ${desbalanceables.length} combos donde el cliente podría cambiar el ítem fijo por otra unidad del grupo:`);
    for (const c of desbalanceables) console.log(`        ${c.name}`);
  }

  const conVariante = combos.filter((c) => c.variantesReferenciadas.length);
  if (conVariante.length) {
    console.log(`  ⚠️  ${conVariante.length} combos apuntan a una variante puntual y la whitelist es por producto:`);
    for (const c of conVariante) console.log(`        ${c.name}: ${c.variantesReferenciadas.join(", ")}`);
  }

  const variantesConDescripcion = productos.flatMap((p) =>
    p.variants.filter((v) => v.descripcionPropia).map((v) => `${p.name} / ${v.nombre}`)
  );
  if (variantesConDescripcion.length) {
    console.log(
      `  ⚠️  ${variantesConDescripcion.length} variantes traen descripción propia y ProductVariant no tiene ese campo: ${variantesConDescripcion.join(", ")}`
    );
  }
}

main();
