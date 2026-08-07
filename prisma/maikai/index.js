// Orquesta el seed completo de maikai (categorías -> productos -> config).
// Requiere que el tenant ya exista:
//   pnpm tenant:create --name "Maikai" --email <email> --profile carta
//
// Cada paso es idempotente por su cuenta, ver los scripts individuales si hace
// falta correr solo uno (pnpm seed:maikai:*).
//   node prisma/maikai/index.js
import "dotenv/config";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { seedMaikaiCategorias } from "./categorias.js";
import { seedMaikaiProductos } from "./productos.js";
import { seedMaikaiConfig } from "./config.js";

async function main() {
  await seedMaikaiCategorias();
  await seedMaikaiProductos();
  await seedMaikaiConfig();
}

main()
  .then(() => console.log("Listo: catálogo completo de maikai sincronizado."))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await prisma.$disconnect();
  });
