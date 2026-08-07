// Reorganiza el menú crudo de Maikai (productsMaikai.json, exportado de la web
// actual del cliente) en el árbol que se carga a la base: ./menu.json.
//
//   node prisma/maikai/build-menu.js
//
// NO se corre en cada seed: `menu.json` está commiteado y es el archivo que se
// edita a mano cuando el cliente cambia un precio. Este script se vuelve a correr
// solo si llega un dump nuevo — por eso la reorganización vive acá, en código
// revisable, y no como un JSON de 3000 líneas editado a ojo.
//
// Las tres cosas que arregla del dump:
//   1. "Almuerzos" es una categoría ESPEJO: sus 20 productos ya están, con el
//      mismo precio, en Pastas / Ensaladas / Menú Ejecutivo. Se descarta entera.
//   2. Hay 5 productos repetidos sueltos (ver DEDUP más abajo).
//   3. Existe "Clásicos" dos veces (bajo Café y bajo Coctelería), y `Categories`
//      tiene @@unique([tenantId, name]) GLOBAL, no por padre: el segundo create
//      fallaría. Se desdobla en "Cafés" y "Coctelería".
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "productsMaikai.json");
const OUTPUT = join(HERE, "menu.json");

// ---------------------------------------------------------------------------
// El árbol destino. Las RAÍCES son los tiles del grid de la home (ver el diseño
// de la landing): 8, una por tile, en el orden en que se muestran. Las hijas son
// las secciones dentro de cada tile.
//
// Máximo 2 niveles, igual que acme y mesa-dulce. `parent: null` = raíz.
// ---------------------------------------------------------------------------
const CATEGORIES = [
  { name: "Pastas", icon: "soup", description: "Pastas al paso, listas en minutos. Ravioles, sorrentinos y fetuccini con salsa a elección." },
  { name: "Almuerzos", icon: "utensils", description: "El plato del mediodía: milanesas, pollo crispy y ensaladas." },
  { name: "Menú Ejecutivo", parent: "Almuerzos", icon: "utensils", description: "Milanesas, pollo crispy y bifes con guarnición." },
  { name: "Ensaladas", parent: "Almuerzos", icon: "salad", description: "Ensaladas de plato principal." },
  { name: "Entre Panes", icon: "sandwich", description: "Ciabattas, focaccias, sándwiches y lomos. Enteros o medios." },
  { name: "Ciabattas", parent: "Entre Panes", icon: "sandwich", description: "Ciabattas enteras y medias." },
  { name: "Focaccias", parent: "Entre Panes", icon: "sandwich", description: "Focaccias enteras y medias." },
  { name: "Sándwiches y Lomos", parent: "Entre Panes", icon: "sandwich", description: "Sándwiches americanos y lomos triple B." },
  { name: "Brunch", icon: "egg", description: "Tostones, bagels, tostados y platos fit. Con sus combos." },
  { name: "Papas", icon: "popcorn", description: "Las papas presidenciales y las clásicas, para compartir." },
  { name: "Papas Presidenciales", parent: "Papas", icon: "popcorn", description: "Porción entera o media." },
  { name: "Papas Fritas", parent: "Papas", icon: "popcorn", description: "Fritas clásicas y con toppings." },
  { name: "Para Compartir", parent: "Papas", icon: "popcorn", description: "Picadas, tablas, nuggets y mini burgers." },
  { name: "Panadería y Postres", icon: "croissant", description: "Croissants, medialunas, tortas y postres del día." },
  { name: "Panadería", parent: "Panadería y Postres", icon: "croissant", description: "Croissants, medialunas, tortitas y tostadas." },
  { name: "Postres", parent: "Panadería y Postres", icon: "cake", description: "Tortas, tartas y cookies." },
  { name: "Café", icon: "coffee", description: "Café de especialidad, frío y caliente, con todos sus agregados." },
  { name: "Cafés", parent: "Café", icon: "coffee", description: "Espressos, lattes, capuccinos y submarinos." },
  { name: "Ice Coffee y Frappé", parent: "Café", icon: "coffee", description: "Café frío y frappés." },
  { name: "Agregados de Café", parent: "Café", icon: "plus", description: "Toppings, salsas y leches vegetales para sumar a cualquier café." },
  { name: "Bebidas", icon: "martini", description: "Coctelería, cervezas, vinos y bebidas sin alcohol." },
  { name: "Coctelería", parent: "Bebidas", icon: "martini", description: "Tragos clásicos y de autor." },
  { name: "Cervezas y Vinos", parent: "Bebidas", icon: "beer", description: "Botellas, latas y cerveza tirada." },
  { name: "Sin Alcohol", parent: "Bebidas", icon: "cup-soda", description: "Gaseosas, jugos, aguas y smoothies." },
];

// Categoría del dump -> categoría destino. El destino es SIEMPRE una hoja (una
// hija, o una raíz sin hijas como Pastas y Brunch): un producto nunca cuelga de
// una raíz que tiene hijas.
const CATEGORY_MAP = {
  Pastas: "Pastas",

  Ensaladas: "Ensaladas",
  // "Menú Ejecutivo" se parte en dos, ver SANDWICH_PREFIX.

  Ciabattas: "Ciabattas",
  Focaccia: "Focaccias",
  Lomos: "Sándwiches y Lomos",

  Brunch: "Brunch",
  // Los 5 "Combos" del dump son de brunch (tostadas + infusión), no combos
  // armables: van como PRODUCTO con la composición en la descripción.
  Combos: "Brunch",
  // El dump deja un solo producto suelto en "Sin categorizar": un yogur griego.
  "Sin categorizar": "Brunch",

  "Papas Presidenciales": "Papas Presidenciales",
  Papas: "Papas Fritas",
  Tapeos: "Para Compartir",

  Dulces: "Panadería",
  Postres: "Postres",

  // "Clásicos" existe dos veces, ver COCKTAILS.
  "Ice Coffe": "Ice Coffee y Frappé",
  Frappe: "Ice Coffee y Frappé",
  "Agregados Café": "Agregados de Café",

  Cervezas: "Cervezas y Vinos",
  // Vinos tenía un solo producto en todo el menú.
  Vinos: "Cervezas y Vinos",

  Gaseosas: "Sin Alcohol",
  Jugos: "Sin Alcohol",
  Aguas: "Sin Alcohol",
  Smoothies: "Sin Alcohol",
};

// Categoría espejo: TODOS sus productos ya existen en otras categorías del mismo
// dump, con el mismo precio. Se descarta antes de mapear.
const MIRROR_CATEGORY = "Almuerzos";

// Los 6 sandwiches americanos venían dentro de "Menú Ejecutivo". Son sándwiches:
// van con las ciabattas y los lomos. El resto del menú ejecutivo (milanesas,
// pollo crispy, bifes, balma chicken) son platos con guarnición.
const SANDWICH_PREFIX = "sandwich americano";

// Desdoble de "Clásicos": estos 17 son los de Coctelería, el resto son los cafés.
// Lista explícita y no una heurística sobre el nombre — "Espresso Maikai" y
// "Espresso Martini" son tragos y se llaman como un café.
const COCKTAILS = new Set([
  "aperol sprit",
  "negroni",
  "vermut",
  "fernet pinta coca tradicional o zero",
  "fernet pinta larga coca tradicional o zero",
  "fernet botella coca 1 5",
  "gin tonic de frutilla",
  "gin tonic de naranja",
  "gin tonic de pomelo",
  "mojito",
  "mojito malibu",
  "vodka sky",
  "vodka absolut",
  "campari",
  "jagger",
  "espresso maikai",
  "espresso martini",
]);

// Cuando el mismo producto aparece en dos categorías con PRECIOS DISTINTOS, el
// dedup por orden de recorrido elegiría el primero que toque, que no siempre es
// el correcto. Acá se fija cuál gana, por nombre normalizado.
//   "Tarta de Coco": $6.000 en Postres, $5.000 en Panadería > Dulces.
// Se toma la de Postres. Es un dato a confirmar con el cliente: puede que la de
// panadería sea la porción y la de postres la torta entera.
const DEDUP_WINNER = {
  "tarta de coco": "Postres",
  "tarta cabsha": "Postres",
};

// ---------------------------------------------------------------------------

// Normaliza para comparar nombres: sin acentos, sin mayúsculas, sin puntuación.
// Es lo que hace que "Bagel Ibérico" y "Bagel Iberico" sean el mismo producto.
function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// SKU derivado del NOMBRE, no de un índice: reordenar el menú no cambia la
// identidad del producto, y por eso el seed puede ser idempotente por SKU.
function buildSku(name, taken) {
  const base = `MK-${normalize(name).toUpperCase().replace(/ /g, "-").slice(0, 38)}`;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  taken.add(`${base}-${n}`);
  return `${base}-${n}`;
}

// Aplana el árbol del dump a { name, description, price, source } donde `source`
// es el nombre de la categoría que lo contenía.
function flatten(nodes, out = []) {
  for (const node of nodes) {
    for (const product of node.products ?? []) {
      out.push({
        name: product.name.trim().replace(/\s+/g, " "),
        // El dump viene con saltos CRLF; el \r suelto ensucia el render.
        description: product.description?.replace(/\r\n?/g, "\n").trim() || null,
        price: Number(product.price),
        source: node.name,
      });
    }
    flatten(node.children ?? [], out);
  }
  return out;
}

function resolveCategory(product) {
  if (product.source === MIRROR_CATEGORY) return null;

  if (product.source === "Menú Ejecutivo") {
    return normalize(product.name).startsWith(SANDWICH_PREFIX)
      ? "Sándwiches y Lomos"
      : "Menú Ejecutivo";
  }

  if (product.source === "Clásicos") {
    return COCKTAILS.has(normalize(product.name)) ? "Coctelería" : "Cafés";
  }

  return CATEGORY_MAP[product.source] ?? null;
}

function main() {
  const raw = JSON.parse(readFileSync(SOURCE, "utf8"));
  const flat = flatten(raw);

  // Orden de salida = orden del árbol destino, para que menu.json se lea igual
  // que la carta. `position` sale de este mismo orden.
  const order = new Map(CATEGORIES.map((c, index) => [c.name, index]));

  const routed = [];
  const unmapped = [];
  for (const product of flat) {
    const category = resolveCategory(product);
    if (product.source === MIRROR_CATEGORY) continue;
    if (!category) {
      unmapped.push(product);
      continue;
    }
    routed.push({ ...product, category });
  }

  routed.sort((a, b) => order.get(a.category) - order.get(b.category));

  const seen = new Map();
  const skus = new Set();
  const products = [];
  const dropped = [];

  for (const product of routed) {
    const key = normalize(product.name);
    const winner = DEDUP_WINNER[key];

    if (seen.has(key)) {
      dropped.push(`${product.name} (${product.source}, $${product.price})`);
      continue;
    }
    // Si hay un ganador declarado y este no es, se saltea aunque venga primero.
    if (winner && product.source !== winner) {
      dropped.push(`${product.name} (${product.source}, $${product.price})`);
      continue;
    }

    seen.set(key, true);
    products.push({
      sku: buildSku(product.name, skus),
      name: product.name,
      description: product.description,
      price: product.price,
      category: product.category,
    });
  }

  // `position` es por nivel: las raíces entre sí, y las hijas dentro de su padre.
  const positions = new Map();
  const categories = CATEGORIES.map((category) => {
    const scope = category.parent ?? "__root__";
    const position = positions.get(scope) ?? 0;
    positions.set(scope, position + 1);
    return {
      name: category.name,
      parent: category.parent ?? null,
      position,
      icon: category.icon,
      description: category.description,
    };
  });

  writeFileSync(OUTPUT, `${JSON.stringify({ categories, products }, null, 2)}\n`, "utf8");

  // --- Resumen (es la verificación del script) -----------------------------
  const count = (name) => products.filter((p) => p.category === name).length;
  console.log(`Origen: ${flat.length} filas de producto en productsMaikai.json`);
  console.log(`  − ${flat.filter((p) => p.source === MIRROR_CATEGORY).length} de "${MIRROR_CATEGORY}" (categoría espejo)`);
  console.log(`  − ${dropped.length} repetidos: ${dropped.join(" | ")}`);
  if (unmapped.length) {
    console.log(`  ⚠️  ${unmapped.length} SIN MAPEAR: ${unmapped.map((p) => `${p.name} (${p.source})`).join(" | ")}`);
  }
  console.log("");

  for (const category of categories) {
    if (category.parent) continue;
    const children = categories.filter((c) => c.parent === category.name);
    const total = children.length
      ? children.reduce((sum, c) => sum + count(c.name), 0)
      : count(category.name);
    console.log(`${category.name.padEnd(24)} ${String(total).padStart(4)}`);
    for (const child of children) {
      console.log(`  ${child.name.padEnd(22)} ${String(count(child.name)).padStart(4)}`);
    }
  }

  console.log(`\n${"TOTAL".padEnd(24)} ${String(products.length).padStart(4)} productos`);
  console.log(`${"".padEnd(24)} ${String(categories.filter((c) => !c.parent).length).padStart(4)} raíces + ${categories.filter((c) => c.parent).length} subcategorías`);
  console.log(`\nEscrito: ${OUTPUT}`);
}

main();
