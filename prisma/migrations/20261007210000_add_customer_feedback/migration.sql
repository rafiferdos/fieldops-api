BEGIN;

CREATE TABLE "Feedback" (
  "id" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "rating" SMALLINT NOT NULL,
  "comment" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Feedback_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "Feedback_comment_nonblank" CHECK (
    "comment" IS NULL OR (char_length("comment") BETWEEN 1 AND 1000 AND "comment" ~ '[^[:space:]]')
  ),
  CONSTRAINT "Feedback_created_at_finite" CHECK (isfinite("createdAt"))
);

CREATE UNIQUE INDEX "Feedback_workOrderId_key" ON "Feedback"("workOrderId");
CREATE INDEX "Feedback_customerId_createdAt_id_idx" ON "Feedback"("customerId", "createdAt", "id");
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Eligibility is checked once at insertion; historical account/catalog changes do not rewrite reviews.
-- The invoice's deferred settlement constraints independently require verified payment evidence.
CREATE FUNCTION fieldops_protect_feedback() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Submitted feedback is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'Feedback_immutable_submission';
  END IF;
  PERFORM 1 FROM "WorkOrder" w
    JOIN "ServiceRequest" r ON r.id = w."requestId"
    JOIN "Invoice" i ON i."workOrderId" = w.id
    WHERE w.id = NEW."workOrderId" AND w.status = 'COMPLETED'
      AND r."deletedAt" IS NULL AND r."customerId" = NEW."customerId"
      AND i."customerId" = NEW."customerId" AND i.status = 'PAID'
    FOR SHARE OF r, w, i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback requires the owning customer and completed, paid work'
      USING ERRCODE = '23514', CONSTRAINT = 'Feedback_completed_paid_owner';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Feedback_protect_submission" BEFORE INSERT OR UPDATE ON "Feedback"
  FOR EACH ROW EXECUTE FUNCTION fieldops_protect_feedback();

COMMIT;
