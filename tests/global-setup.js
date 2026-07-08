import { execSync } from "node:child_process";

export default async function setup() {
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error(
      `[tests] DATABASE_URL no apunta a una DB de test (debe contener "_test"). ` +
        `Verificá .env.test. Valor actual: ${process.env.DATABASE_URL}`
    );
  }

  // `migrate deploy` (no `db push`): aplica el historial real de migraciones, incluido
  // SQL escrito a mano que no es representable en schema.prisma (ej. el índice único
  // parcial de CartItem en 20260708190000_product_types_add) — `db push` solo mira el
  // datamodel declarativo y se saltearía ese tipo de constraints.
  console.log("[tests] aplicando migraciones en DB de test...");
  execSync("npx prisma migrate deploy --schema=prisma/schema.prisma", {
    stdio: "inherit",
    env: process.env,
  });
}
