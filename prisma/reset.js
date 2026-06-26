/**
 * Reset de la DB de desarrollo: borra TODOS los datos de la app en orden FK-safe,
 * para probar flujos (registro/verificación) desde cero. NO toca el schema.
 *
 * Uso: node prisma/reset.js
 * (corre contra DATABASE_URL del .env — la misma base que usa el server).
 */
import prisma from "../lib/prisma.js";

// Orden FK-safe: hijos antes que padres (ContentSuggestion→Product es RESTRICT).
const STEPS = [
  ["contentSuggestion", () => prisma.contentSuggestion.deleteMany()],
  ["cartItem", () => prisma.cartItem.deleteMany()],
  ["cart", () => prisma.cart.deleteMany()],
  ["orderItem", () => prisma.orderItem.deleteMany()],
  ["orderStatusHistory", () => prisma.orderStatusHistory.deleteMany()],
  ["order", () => prisma.order.deleteMany()],
  ["productVariant", () => prisma.productVariant.deleteMany()],
  ["product", () => prisma.product.deleteMany()],
  ["categories", () => prisma.categories.deleteMany()],
  ["tenantPageSpec", () => prisma.tenantPageSpec.deleteMany()],
  ["tenantConfig", () => prisma.tenantConfig.deleteMany()],
  ["user", () => prisma.user.deleteMany()],
  ["tenant", () => prisma.tenant.deleteMany()],
];

async function main() {
  console.log("Antes del reset:");
  console.log("  tenants:", await prisma.tenant.count());
  console.log("  users:", await prisma.user.count());

  for (const [name, fn] of STEPS) {
    const { count } = await fn();
    console.log(`  borrados ${name}: ${count}`);
  }

  console.log("Después del reset:");
  console.log("  tenants:", await prisma.tenant.count());
  console.log("  users:", await prisma.user.count());
  console.log("✓ DB limpia. Podés registrar de cero.");
}

main()
  .catch((e) => {
    console.error("Error en el reset:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
