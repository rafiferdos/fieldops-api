-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "preferredStart" TIMESTAMPTZ(3) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewReason" VARCHAR(500),
    "reviewedAt" TIMESTAMPTZ(3),
    "cancellationReason" VARCHAR(500),
    "cancelledAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceRequest_customerId_deletedAt_status_createdAt_id_idx" ON "ServiceRequest"("customerId", "deletedAt", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ServiceRequest_deletedAt_status_createdAt_id_idx" ON "ServiceRequest"("deletedAt", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ServiceRequest_serviceId_deletedAt_createdAt_id_idx" ON "ServiceRequest"("serviceId", "deletedAt", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve request invariants even when a writer bypasses HTTP validation.
ALTER TABLE "ServiceRequest"
  ADD CONSTRAINT "ServiceRequest_positive_version" CHECK ("version" >= 1),
  ADD CONSTRAINT "ServiceRequest_text_lengths" CHECK (
    length(btrim("description")) BETWEEN 10 AND 2000 AND
    length(btrim("address")) BETWEEN 10 AND 500 AND
    ("reviewReason" IS NULL OR length(btrim("reviewReason")) BETWEEN 3 AND 500) AND
    ("cancellationReason" IS NULL OR length(btrim("cancellationReason")) BETWEEN 3 AND 500)
  ),
  ADD CONSTRAINT "ServiceRequest_review_facts" CHECK (
    ("status" = 'PENDING' AND "reviewedAt" IS NULL AND "reviewReason" IS NULL) OR
    ("status" = 'APPROVED' AND "reviewedAt" IS NOT NULL) OR
    ("status" = 'REJECTED' AND "reviewedAt" IS NOT NULL AND "reviewReason" IS NOT NULL) OR
    ("status" = 'CANCELLED' AND ("reviewedAt" IS NOT NULL OR "reviewReason" IS NULL))
  ),
  ADD CONSTRAINT "ServiceRequest_cancellation_facts" CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL) OR
    ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL)
  );
