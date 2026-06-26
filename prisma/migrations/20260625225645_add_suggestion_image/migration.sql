-- CreateTable
CREATE TABLE "SuggestionImage" (
    "id" SERIAL NOT NULL,
    "suggestionId" INTEGER NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imagePublicId" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "prompt" TEXT NOT NULL,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuggestionImage_tenantId_idx" ON "SuggestionImage"("tenantId");

-- CreateIndex
CREATE INDEX "SuggestionImage_suggestionId_idx" ON "SuggestionImage"("suggestionId");

-- AddForeignKey
ALTER TABLE "SuggestionImage" ADD CONSTRAINT "SuggestionImage_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "ContentSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionImage" ADD CONSTRAINT "SuggestionImage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
