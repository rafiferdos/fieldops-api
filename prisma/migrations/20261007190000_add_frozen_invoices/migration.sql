BEGIN;

-- Never manufacture invoices for undocumented historical completions.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "WorkOrder" WHERE status = 'COMPLETED') THEN
    RAISE EXCEPTION 'Existing completed work needs explicit invoice reconciliation before migration';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PAID');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BDT',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMPTZ(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_workOrderId_key" ON "Invoice"("workOrderId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_issuedAt_id_idx" ON "Invoice"("customerId", "issuedAt", "id");

-- CreateIndex
CREATE INDEX "Invoice_status_issuedAt_id_idx" ON "Invoice"("status", "issuedAt", "id");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_amount_range" CHECK ("amountMinor" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "Invoice_payment_facts" CHECK (
    isfinite("issuedAt") AND (
      (status = 'UNPAID' AND "paidAt" IS NULL) OR
      (status = 'PAID' AND "paidAt" IS NOT NULL AND isfinite("paidAt") AND "paidAt" >= "issuedAt")
    )
  );

-- Frozen identity and amount; settlement may only move UNPAID -> PAID once.
CREATE FUNCTION fieldops_protect_invoice() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE snapshot record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT w.status, w."agreedPriceMinor", w.currency, w."completedAt", r."customerId"
      INTO snapshot FROM "WorkOrder" w JOIN "ServiceRequest" r ON r.id = w."requestId"
      WHERE w.id = NEW."workOrderId" FOR SHARE OF w, r;
    IF NOT FOUND OR snapshot.status <> 'COMPLETED' OR
       NEW."customerId" IS DISTINCT FROM snapshot."customerId" OR
       NEW."amountMinor" IS DISTINCT FROM snapshot."agreedPriceMinor" OR
       NEW.currency IS DISTINCT FROM snapshot.currency OR
       NEW."issuedAt" < snapshot."completedAt" OR
       NEW.status <> 'UNPAID' OR NEW."paidAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invoice must snapshot completed work and start unpaid'
        USING ERRCODE = '23514', CONSTRAINT = 'Invoice_completion_snapshot';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW."workOrderId", NEW."customerId", NEW."amountMinor", NEW.currency, NEW."issuedAt")
       IS DISTINCT FROM
       ROW(OLD.id, OLD."workOrderId", OLD."customerId", OLD."amountMinor", OLD.currency, OLD."issuedAt") OR
       (OLD.status = 'PAID' AND ROW(NEW.status, NEW."paidAt") IS DISTINCT FROM ROW(OLD.status, OLD."paidAt")) THEN
      RAISE EXCEPTION 'Invoice snapshot and settled payment facts are immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'Invoice_immutable_snapshot';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Invoice_protect_snapshot" BEFORE INSERT OR UPDATE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION fieldops_protect_invoice();

CREATE FUNCTION fieldops_protect_work_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF ROW(NEW.id, NEW."requestId", NEW."agreedPriceMinor", NEW.currency, NEW."createdAt") IS DISTINCT FROM
     ROW(OLD.id, OLD."requestId", OLD."agreedPriceMinor", OLD.currency, OLD."createdAt") OR
     (OLD.status = 'COMPLETED' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Work identity, agreed price and completed work are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'WorkOrder_immutable_snapshot';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "WorkOrder_protect_snapshot" BEFORE UPDATE ON "WorkOrder"
  FOR EACH ROW EXECUTE FUNCTION fieldops_protect_work_identity();

CREATE FUNCTION fieldops_protect_request_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF ROW(NEW.id, NEW."customerId", NEW."serviceId", NEW."createdAt") IS DISTINCT FROM
     ROW(OLD.id, OLD."customerId", OLD."serviceId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Request identity, customer and service are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'ServiceRequest_immutable_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ServiceRequest_protect_identity" BEFORE UPDATE ON "ServiceRequest"
  FOR EACH ROW EXECUTE FUNCTION fieldops_protect_request_identity();

-- Completion and its unique invoice may be written in either order within one transaction.
-- Validate final state at COMMIT, also preventing standalone invoice deletion.
CREATE FUNCTION fieldops_require_completion_invoice() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE order_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'WorkOrder' THEN
    IF TG_OP = 'DELETE' THEN order_id := OLD.id; ELSE order_id := NEW.id; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN order_id := OLD."workOrderId"; ELSE order_id := NEW."workOrderId"; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "WorkOrder" WHERE id = order_id AND status = 'COMPLETED') AND
     NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "workOrderId" = order_id) THEN
    RAISE EXCEPTION 'Completed work requires exactly one invoice'
      USING ERRCODE = '23514', CONSTRAINT = 'WorkOrder_completion_invoice';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "WorkOrder_requires_invoice"
  AFTER INSERT OR UPDATE ON "WorkOrder" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fieldops_require_completion_invoice();
CREATE CONSTRAINT TRIGGER "Invoice_preserves_completion"
  AFTER INSERT OR UPDATE OR DELETE ON "Invoice" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fieldops_require_completion_invoice();

COMMIT;
