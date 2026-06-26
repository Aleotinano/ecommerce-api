/**
 * Marca usuarios como verificados sin pasar por el email (solo para DEV/test).
 * Setea emailVerified=true y limpia el token de verificación.
 *
 * Uso:
 *   node prisma/verify.js                 → verifica TODOS los users sin verificar
 *   node prisma/verify.js mail@ejemplo.com → verifica solo ese email
 */
import prisma from "../lib/prisma.js";

const email = process.argv[2];

async function main() {
  const where = email
    ? { email }
    : { emailVerified: false };

  const { count } = await prisma.user.updateMany({
    where,
    data: {
      emailVerified: true,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    },
  });

  console.log(
    email
      ? `✓ ${count} usuario(s) con email ${email} marcados como verificados.`
      : `✓ ${count} usuario(s) sin verificar marcados como verificados.`
  );
}

main()
  .catch((e) => {
    console.error("Error verificando:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
