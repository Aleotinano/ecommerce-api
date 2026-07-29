-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "fulfillmentMethodsEnabled" "FulfillmentMethod"[] DEFAULT ARRAY['DELIVERY', 'PICKUP']::"FulfillmentMethod"[],
ADD COLUMN     "paymentMethodsEnabled" "OrderPaymentMethod"[] DEFAULT ARRAY['CASH', 'TRANSFER', 'MIXED']::"OrderPaymentMethod"[];
