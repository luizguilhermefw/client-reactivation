-- CreateTable
CREATE TABLE "CustomerRegistrationLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRegistrationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRegistrationLink_publicId_key" ON "CustomerRegistrationLink"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRegistrationLink_companyId_key" ON "CustomerRegistrationLink"("companyId");

-- AddForeignKey
ALTER TABLE "CustomerRegistrationLink" ADD CONSTRAINT "CustomerRegistrationLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
