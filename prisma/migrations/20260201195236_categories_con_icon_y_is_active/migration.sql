/*
  Warnings:

  - Added the required column `isActive` to the `Categories` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Categories" ADD COLUMN     "icon" BOOLEAN,
ADD COLUMN     "isActive" BOOLEAN NOT NULL;
