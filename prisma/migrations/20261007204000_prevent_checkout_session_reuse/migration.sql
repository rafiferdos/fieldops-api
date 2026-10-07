-- A merchant checkout session cannot be attached to two invoice attempts.
CREATE UNIQUE INDEX "Payment_gatewayMode_gatewayStoreId_sessionKey_key"
ON "Payment" ("gatewayMode", "gatewayStoreId", "sessionKey");
