-- Explicit NULL checks are essential: PostgreSQL CHECK accepts UNKNOWN.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_required_provider_facts" CHECK (
  ("status" <> 'SUCCEEDED' OR ("providerTranId" IS NOT NULL AND length("providerTranId") > 0))
  AND ("status" <> 'PENDING' OR ("sessionKey" IS NOT NULL AND "checkoutUrl" IS NOT NULL))
);
