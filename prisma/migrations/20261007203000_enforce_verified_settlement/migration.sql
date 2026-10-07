BEGIN;
-- Never invent evidence for historical paid data.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Invoice" i WHERE i."status" = 'PAID' AND NOT EXISTS (
    SELECT 1 FROM "Payment" p JOIN "PaymentReceipt" r ON r."paymentId" = p."id"
    WHERE p."invoiceId" = i."id" AND p."status" = 'SUCCEEDED' AND r."disposition" = 'SETTLED'
      AND r."providerTranId" = p."providerTranId" AND i."paidAt" = p."settledAt")) THEN
    RAISE EXCEPTION 'Historical paid invoices require verified settlement evidence before migration';
  END IF;
END $$;
CREATE FUNCTION fieldops_assert_verified_settlement(bill_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE bill "Invoice"%ROWTYPE; winner "Payment"%ROWTYPE; receipt "PaymentReceipt"%ROWTYPE;
BEGIN
  SELECT * INTO bill FROM "Invoice" WHERE "id" = bill_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO winner FROM "Payment" WHERE "invoiceId" = bill_id AND "status" = 'SUCCEEDED';
  IF bill."status" = 'PAID' THEN
    IF NOT FOUND OR bill."paidAt" IS DISTINCT FROM winner."settledAt" THEN
      RAISE EXCEPTION 'Paid invoice requires a matching settlement' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO receipt FROM "PaymentReceipt" WHERE "paymentId" = winner."id" AND "disposition" = 'SETTLED';
    IF NOT FOUND OR receipt."providerTranId" IS DISTINCT FROM winner."providerTranId"
      OR receipt."amountMinor" <> bill."amountMinor" OR receipt."originalAmountMinor" <> bill."amountMinor"
      OR receipt."currency" <> 'BDT' OR receipt."originalCurrency" <> 'BDT' OR receipt."risky" THEN
      RAISE EXCEPTION 'Settlement requires matching verified safe receipt' USING ERRCODE = '23514';
    END IF;
  ELSIF FOUND THEN
    RAISE EXCEPTION 'Successful payment requires a paid invoice' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "PaymentReceipt" r JOIN "Payment" p ON p."id" = r."paymentId"
    WHERE p."invoiceId" = bill_id AND r."disposition" = 'SETTLED' AND
      (p."status" <> 'SUCCEEDED' OR p."providerTranId" IS DISTINCT FROM r."providerTranId")) THEN
    RAISE EXCEPTION 'Settled receipt requires a successful payment' USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE FUNCTION fieldops_check_verified_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bill_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'Invoice' THEN
    bill_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  ELSIF TG_TABLE_NAME = 'Payment' THEN
    bill_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."invoiceId" ELSE NEW."invoiceId" END;
  ELSE
    SELECT "invoiceId" INTO bill_id FROM "Payment"
      WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."paymentId" ELSE NEW."paymentId" END;
  END IF;
  IF bill_id IS NOT NULL THEN PERFORM fieldops_assert_verified_settlement(bill_id); END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "Invoice_verified_settlement" AFTER INSERT OR UPDATE OR DELETE ON "Invoice"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fieldops_check_verified_settlement();
CREATE CONSTRAINT TRIGGER "Payment_verified_settlement" AFTER INSERT OR UPDATE OR DELETE ON "Payment"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fieldops_check_verified_settlement();
CREATE CONSTRAINT TRIGGER "PaymentReceipt_verified_settlement" AFTER INSERT OR UPDATE OR DELETE ON "PaymentReceipt"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fieldops_check_verified_settlement();
COMMIT;
