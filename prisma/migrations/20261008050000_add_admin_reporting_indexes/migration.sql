-- Support administration lists and bounded reporting without altering domain constraints.
CREATE INDEX "User_deletedAt_createdAt_id_idx" ON "User"("deletedAt", "createdAt", "id");
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");
CREATE INDEX "ServiceRequest_deletedAt_createdAt_id_idx" ON "ServiceRequest"("deletedAt", "createdAt", "id");
CREATE INDEX "WorkOrder_createdAt_status_idx" ON "WorkOrder"("createdAt", "status");
CREATE INDEX "Invoice_status_paidAt_id_idx" ON "Invoice"("status", "paidAt", "id");
