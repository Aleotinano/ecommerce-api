// Orquesta el seed completo de Punto Healthy.
// Requiere que el tenant ya exista:
//   pnpm tenant:create --name "Punto Healthy" --email <email> --profile estandar
//
// El orden no es negociable: los productos necesitan sus categorías y el catálogo de
// atributos, y los combos necesitan los productos para referenciarlos por id.
//
// Cada paso es idempotente por su cuenta, ver los scripts individuales si hace falta
// correr solo uno (pnpm seed:punto-healthy:*). Si cambió la carta, antes de todo esto
// va "pnpm punto-healthy:build-menu".
//   node prisma/punto-healthy/index.js
import "dotenv/config";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { seedPuntoHealthyCategorias } from "./categorias.js";
import { seedPuntoHealthyAtributos } from "./atributos.js";
import { seedPuntoHealthyProductos } from "./productos.js";
import { seedPuntoHealthyCombos } from "./combos.js";
import { seedPuntoHealthyConfig } from "./config.js";

async function main() {
  await seedPuntoHealthyCategorias();
  await seedPuntoHealthyAtributos();
  await seedPuntoHealthyProductos();
  await seedPuntoHealthyCombos();
  await seedPuntoHealthyConfig();
}

main()
  .then(() => console.log("Listo: catálogo completo de punto-healthy sincronizado."))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await prisma.$disconnect();
  });
