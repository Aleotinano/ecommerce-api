-- DropForeignKey
ALTER TABLE "Cart" DROP CONSTRAINT "Cart_userId_fkey";

-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "guestId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Cart_tenantId_guestId_key" ON "Cart"("tenantId", "guestId");

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK: exactamente un owner (userId XOR guestId), ver comentario en schema.prisma.
-- No se declara en el schema (`@@check` no existe en Prisma) para no generar drift
-- en `migrate diff` — mismo patrón que otros constraints agregados a mano en este repo.
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_owner_xor_check" CHECK (
  (("userId" IS NOT NULL) AND ("guestId" IS NULL)) OR
  (("userId" IS NULL) AND ("guestId" IS NOT NULL))
);
