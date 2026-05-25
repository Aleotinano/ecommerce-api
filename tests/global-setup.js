import { execSync } from "node:child_process";

export default async function setup() {
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error(
      `[tests] DATABASE_URL no apunta a una DB de test (debe contener "_test"). ` +
        `Verificá .env.test. Valor actual: ${process.env.DATABASE_URL}`
    );
  }

  console.log("[tests] sincronizando schema en DB de test...");
  execSync(
    `npx prisma db push --schema=prisma/schema.prisma --url="${process.env.DATABASE_URL}" --accept-data-loss`,
    {
      stdio: "inherit",
      env: process.env,
    }
  );
}
