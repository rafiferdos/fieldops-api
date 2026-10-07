BEGIN;
-- CreateEnum
CREATE TYPE "ReceiptDisposition" AS ENUM ('SETTLED', 'REVIEW');

-- CreateTable
CREATE TABLE "PaymentReceipt" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "providerTranId" VARCHAR(80) NOT NULL,
    "validationId" VARCHAR(50) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "originalAmountMinor" INTEGER NOT NULL,
    "originalCurrency" VARCHAR(3) NOT NULL,
    "risky" BOOLEAN NOT NULL,
    "disposition" "ReceiptDisposition" NOT NULL,
    "reviewReason" VARCHAR(50),
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReceipt_providerTranId_key" ON "PaymentReceipt"("providerTranId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReceipt_validationId_key" ON "PaymentReceipt"("validationId");

-- CreateIndex
CREATE INDEX "PaymentReceipt_paymentId_disposition_idx" ON "PaymentReceipt"("paymentId", "disposition");

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Each captured bank transaction is recorded, including duplicate charges needing review.
CREATE UNIQUE INDEX "PaymentReceipt_one_settled_receipt" ON "PaymentReceipt" ("paymentId") WHERE "disposition" = 'SETTLED';
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_facts" CHECK (
  "amountMinor" BETWEEN 0 AND 1000000000 AND "originalAmountMinor" BETWEEN 0 AND 1000000000
  AND length("providerTranId") > 0 AND length("validationId") > 0 AND isfinite("verifiedAt")
  AND (("disposition" = 'REVIEW') = ("reviewReason" IS NOT NULL))
  AND ("disposition" <> 'SETTLED' OR (NOT "risky" AND "currency" = 'BDT' AND "originalCurrency" = 'BDT'))
);
CREATE FUNCTION fieldops_protect_payment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt "Payment"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Verified payment receipts are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO attempt FROM "Payment" WHERE "id" = NEW."paymentId" FOR SHARE;
  IF NOT FOUND OR (NEW."disposition" = 'SETTLED' AND (
    NEW."amountMinor" <> attempt."amountMinor" OR NEW."originalAmountMinor" <> attempt."amountMinor")) THEN
    RAISE EXCEPTION 'Settled receipt must match the invoice snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PaymentReceipt_protect" BEFORE INSERT OR UPDATE ON "PaymentReceipt"
FOR EACH ROW EXECUTE FUNCTION fieldops_protect_payment_receipt();
COMMIT;
