// Orquesta el seed completo de mesa-dulce (categorías -> productos/combos/promo ->
// config). Requiere que el tenant ya exista:
//   pnpm tenant:create --name "Mesa Dulce" --email <email> --profile estandar
//
// El orden no es negociable: los productos necesitan sus categorías, y los combos
// necesitan los productos que van a poder elegirse dentro de ellos.
//
// Las ÓRDENES DE DEMO (./ordenes.js) quedan deliberadamente afuera de este
// orquestador: son 6 pedidos falsos de usuarios ficticios @mesadulce.com y este
// script se corre contra la base de producción. Siguen disponibles para dev con
// "pnpm seed:mesa-dulce:ordenes", y `prisma/seed.js` las sigue sembrando por su
// cuenta (importa los módulos sueltos, no este index).
//
// Cada paso es idempotente por su cuenta, ver los scripts individuales si hace falta
// correr solo uno (pnpm seed:mesa-dulce:*).
//   node prisma/mesa-dulce/index.js
import "dotenv/config";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { seedMesaDulceCategorias } from "./categorias.js";
import { seedMesaDulceProductos } from "./productos.js";
import { seedMesaDulceConfig } from "./config.js";

async function main() {
  await seedMesaDulceCategorias();
  await seedMesaDulceProductos();
  await seedMesaDulceConfig();
}

main()
  .then(() => console.log("Listo: catálogo completo de mesa-dulce sincronizado."))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await prisma.$disconnect();
  });
