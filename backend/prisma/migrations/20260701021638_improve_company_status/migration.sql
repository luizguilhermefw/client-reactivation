/*
  Warnings:

  - The `status` column on the `Company` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "approvedAt" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "CompanyStatus" NOT NULL DEFAULT 'PENDING';
