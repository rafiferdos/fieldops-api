-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TechnicianSkill" (
    "userId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianSkill_pkey" PRIMARY KEY ("userId","serviceId")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "technicianId" UUID NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'ASSIGNED',
    "scheduledStart" TIMESTAMPTZ(3) NOT NULL,
    "scheduledEnd" TIMESTAMPTZ(3) NOT NULL,
    "agreedPriceMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BDT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMPTZ(3),
    "report" VARCHAR(2000),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianSkill_serviceId_userId_idx" ON "TechnicianSkill"("serviceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_requestId_key" ON "WorkOrder"("requestId");

-- CreateIndex
CREATE INDEX "WorkOrder_technicianId_status_scheduledStart_id_idx" ON "WorkOrder"("technicianId", "status", "scheduledStart", "id");

-- CreateIndex
CREATE INDEX "WorkOrder_status_scheduledStart_id_idx" ON "WorkOrder"("status", "scheduledStart", "id");

-- AddForeignKey
ALTER TABLE "TechnicianSkill" ADD CONSTRAINT "TechnicianSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianSkill" ADD CONSTRAINT "TechnicianSkill_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Adjacent [start,end) visits are allowed. Every active visit is protected in PostgreSQL.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "WorkOrder"
  ADD CONSTRAINT "WorkOrder_visit_range" CHECK (
    isfinite("scheduledStart") AND isfinite("scheduledEnd") AND
    "scheduledStart" < "scheduledEnd" AND
    "scheduledEnd" - "scheduledStart" <= interval '8 hours'
  ),
  ADD CONSTRAINT "WorkOrder_price_range" CHECK ("agreedPriceMinor" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "WorkOrder_positive_version" CHECK ("version" >= 1),
  ADD CONSTRAINT "WorkOrder_completion_facts" CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "report" IS NOT NULL AND length(btrim("report")) BETWEEN 10 AND 2000) OR
    ("status" <> 'COMPLETED' AND "completedAt" IS NULL AND "report" IS NULL)
  ),
  ADD CONSTRAINT "WorkOrder_cancellation_facts" CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL) OR
    ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL)
  ),
  ADD CONSTRAINT "WorkOrder_no_technician_overlap"
  EXCLUDE USING gist (
    "technicianId" WITH =,
    tstzrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  ) WHERE ("status" IN ('ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS'));
