// Orquesta el seed completo de Pastaia.
// Requiere que el tenant ya exista:
//   pnpm tenant:create --name "Pastaia" --email <email> --profile estandar
//
// El orden no es negociable: los productos necesitan sus categorías y el catálogo de
// atributos (`validateAttributes` rechaza cualquier key que no esté cargada).
//
// Cada paso es idempotente por su cuenta, ver los scripts individuales si hace falta
// correr solo uno (pnpm seed:pastaia:*). Si cambió un precio o se sumó un relleno,
// antes de todo esto va "pnpm pastaia:build-menu".
//   node prisma/pastaia/index.js
import "dotenv/config";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { seedPastaiaCategorias } from "./categorias.js";
import { seedPastaiaAtributos } from "./atributos.js";
import { seedPastaiaProductos } from "./productos.js";
import { seedPastaiaConfig } from "./config.js";

async function main() {
  await seedPastaiaCategorias();
  await seedPastaiaAtributos();
  await seedPastaiaProductos();
  await seedPastaiaConfig();
}

main()
  .then(() => console.log("Listo: catálogo completo de pastaia sincronizado."))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await prisma.$disconnect();
  });
