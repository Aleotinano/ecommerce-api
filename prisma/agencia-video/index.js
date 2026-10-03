// Orquesta el seed completo de agencia-video.
// Requiere que el tenant ya exista:
//   pnpm tenant:create --name "Agencia Video" --email <email> --profile carta
//
// El orden no es negociable: los servicios necesitan sus categorías y el atributo
// `plan` (`validateAttributes` rechaza cualquier key que no esté cargada).
//
// Cada paso es idempotente por su cuenta (pnpm seed:agencia-video:*). Para cambiar un
// precio: editar servicios.json y volver a correr esto (o solo :productos).
//   node prisma/agencia-video/index.js
import "dotenv/config";

import prisma from "../../lib/prisma.js";
import { closeRedis } from "../../lib/redis.js";
import { seedAgenciaVideoCategorias } from "./categorias.js";
import { seedAgenciaVideoAtributos } from "./atributos.js";
import { seedAgenciaVideoProductos } from "./productos.js";
import { seedAgenciaVideoConfig } from "./config.js";

async function main() {
  await seedAgenciaVideoCategorias();
  await seedAgenciaVideoAtributos();
  await seedAgenciaVideoProductos();
  await seedAgenciaVideoConfig();
}

main()
  .then(() => console.log("Listo: catálogo completo de agencia-video sincronizado."))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await prisma.$disconnect();
  });
