-- CreateEnum
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'STAFF', 'CUSTOMER');

-- Drop default before changing type
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

-- Migrate existing data: USER -> CUSTOMER
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE "role"::text
    WHEN 'USER' THEN 'CUSTOMER'::"Role_new"
    ELSE "role"::text::"Role_new"
  END
);

-- Drop old enum and rename new one
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- Set new default
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER'::"Role";

-- Drop old global email unique constraint
DROP INDEX IF EXISTS "User_email_key";

-- Add new tenant-scoped email unique constraint
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");
