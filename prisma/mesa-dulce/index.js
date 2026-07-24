// Orquesta el seed completo de mesa-dulce (categorías -> productos/combos/promo
// -> órdenes de demo). Requiere que el tenant y sus usuarios ya existan (los
// crea "pnpm seed"). Cada paso es idempotente por su cuenta, ver los scripts
// individuales si hace falta correr solo uno:
//   node prisma/mesa-dulce/index.js
import "dotenv/config";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { seedMesaDulceCategorias } from "./categorias.js";
import { seedMesaDulceProductos } from "./productos.js";
import { seedMesaDulceOrdenes } from "./ordenes.js";

async function main() {
  await seedMesaDulceCategorias();
  await seedMesaDulceProductos();
  await seedMesaDulceOrdenes();
}

main()
  .then(() => console.log("Listo: catálogo completo de mesa-dulce sincronizado."))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await prisma.$disconnect();
  });
