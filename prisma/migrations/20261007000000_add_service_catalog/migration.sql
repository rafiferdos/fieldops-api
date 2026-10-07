-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('BDT');

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "basePriceMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BDT',
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogRevision" (
    "id" INTEGER NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogRevision_pkey" PRIMARY KEY ("id")
);

-- Money stays within the application limit even if a writer bypasses HTTP validation.
ALTER TABLE "Service" ADD CONSTRAINT "Service_price_range"
  CHECK ("basePriceMinor" BETWEEN 0 AND 1000000000);
ALTER TABLE "CatalogRevision" ADD CONSTRAINT "CatalogRevision_singleton"
  CHECK (id = 1 AND revision >= 0);
INSERT INTO "CatalogRevision" (id, revision) VALUES (1, 0);

-- CreateIndex
CREATE INDEX "Service_deletedAt_createdAt_id_idx" ON "Service"("deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Service_deletedAt_basePriceMinor_id_idx" ON "Service"("deletedAt", "basePriceMinor", "id");
