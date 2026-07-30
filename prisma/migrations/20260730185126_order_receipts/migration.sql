-- CreateTable
CREATE TABLE "OrderReceipt" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "orderPaymentId" INTEGER,
    "storageProvider" TEXT NOT NULL DEFAULT 'cloudinary',
    "publicId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "deliveryType" TEXT NOT NULL,
    "format" TEXT,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "originalName" TEXT,
    "note" TEXT,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" INTEGER,

    CONSTRAINT "OrderReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderReceipt_orderId_idx" ON "OrderReceipt"("orderId");

-- CreateIndex
CREATE INDEX "OrderReceipt_tenantId_idx" ON "OrderReceipt"("tenantId");

-- CreateIndex
CREATE INDEX "OrderReceipt_orderPaymentId_idx" ON "OrderReceipt"("orderPaymentId");

-- CreateIndex
CREATE INDEX "OrderReceipt_tenantId_createdAt_idx" ON "OrderReceipt"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderReceipt" ADD CONSTRAINT "OrderReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReceipt" ADD CONSTRAINT "OrderReceipt_orderPaymentId_fkey" FOREIGN KEY ("orderPaymentId") REFERENCES "OrderPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReceipt" ADD CONSTRAINT "OrderReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
