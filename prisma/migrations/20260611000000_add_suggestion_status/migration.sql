-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('SUGGESTED', 'USED', 'DISMISSED');

-- AlterTable
ALTER TABLE "ContentSuggestion" ADD COLUMN "status" "SuggestionStatus" NOT NULL DEFAULT 'SUGGESTED';
