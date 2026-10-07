BEGIN;

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATING', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REVIEW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GatewayMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gatewayMode" "GatewayMode" NOT NULL,
    "gatewayStoreId" VARCHAR(30) NOT NULL,
    "merchantTranId" CHAR(24) NOT NULL,
    "providerTranId" VARCHAR(80),
    "sessionKey" VARCHAR(50),
    "checkoutUrl" VARCHAR(255),
    "amountMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BDT',
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATING',
    "reviewReason" VARCHAR(50),
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "settledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_merchantTranId_key" ON "Payment"("merchantTranId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTranId_key" ON "Payment"("providerTranId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_status_idx" ON "Payment"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_id_idx" ON "Payment"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_userId_idempotencyKey_key" ON "Payment"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- REVIEW may include multiple captured transactions; it blocks new sessions in policy.
-- Only one checkout/uncertain initiation may remain active for an invoice.
CREATE UNIQUE INDEX "Payment_one_active_checkout" ON "Payment" ("invoiceId")
WHERE "status" IN ('INITIATING', 'PENDING', 'UNKNOWN');
CREATE UNIQUE INDEX "Payment_one_settlement" ON "Payment" ("invoiceId")
WHERE "status" = 'SUCCEEDED';
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount" CHECK ("amountMinor" BETWEEN 1000 AND 50000000),
  ADD CONSTRAINT "Payment_identifiers" CHECK (
    "merchantTranId" ~ '^[a-f0-9]{24}$' AND "requestHash" ~ '^[a-f0-9]{64}$'
    AND "idempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$'
    AND length("gatewayStoreId") > 0),
  ADD CONSTRAINT "Payment_dates" CHECK (
    isfinite("createdAt") AND isfinite("updatedAt")
    AND ("verifiedAt" IS NULL OR (isfinite("verifiedAt") AND "verifiedAt" >= "createdAt"))
    AND ("settledAt" IS NULL OR (isfinite("settledAt") AND "settledAt" >= "createdAt"))),
  ADD CONSTRAINT "Payment_status_facts" CHECK (
    (("status" = 'SUCCEEDED') = ("settledAt" IS NOT NULL))
    AND ("status" <> 'SUCCEEDED' OR ("verifiedAt" IS NOT NULL AND length("providerTranId") > 0))
    AND (("status" = 'REVIEW') = ("reviewReason" IS NOT NULL))
    AND ("status" <> 'PENDING' OR (length("sessionKey") > 0 AND length("checkoutUrl") > 0))
    AND ("status" NOT IN ('FAILED', 'CANCELLED') OR "verifiedAt" IS NOT NULL));

CREATE FUNCTION fieldops_protect_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bill "Invoice"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO bill FROM "Invoice" WHERE "id" = NEW."invoiceId" FOR SHARE;
    IF NOT FOUND OR bill."customerId" <> NEW."userId"
      OR bill."amountMinor" <> NEW."amountMinor" OR bill."currency" <> NEW."currency"
      OR bill."status" <> 'UNPAID' OR NEW."status" <> 'INITIATING'
      OR NEW."providerTranId" IS NOT NULL OR NEW."verifiedAt" IS NOT NULL
      OR NEW."settledAt" IS NOT NULL OR NEW."sessionKey" IS NOT NULL OR NEW."checkoutUrl" IS NOT NULL THEN
      RAISE EXCEPTION 'Payment must start from an unpaid invoice snapshot' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW."id", NEW."invoiceId", NEW."userId", NEW."gatewayMode", NEW."gatewayStoreId",
      NEW."merchantTranId", NEW."amountMinor", NEW."currency", NEW."idempotencyKey", NEW."requestHash", NEW."createdAt")
      IS DISTINCT FROM ROW(OLD."id", OLD."invoiceId", OLD."userId", OLD."gatewayMode", OLD."gatewayStoreId",
      OLD."merchantTranId", OLD."amountMinor", OLD."currency", OLD."idempotencyKey", OLD."requestHash", OLD."createdAt")
      OR (OLD."status" = 'SUCCEEDED' AND NEW IS DISTINCT FROM OLD)
      OR (OLD."providerTranId" IS NOT NULL AND NEW."providerTranId" IS DISTINCT FROM OLD."providerTranId") THEN
      RAISE EXCEPTION 'Payment identity and settled facts are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Payment_protect" BEFORE INSERT OR UPDATE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION fieldops_protect_payment();

COMMIT;
