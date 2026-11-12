ALTER TABLE "Run" ADD COLUMN "clientId" TEXT;
ALTER TABLE "Run" ADD COLUMN "deviceName" TEXT;
ALTER TABLE "Run" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "Run" ADD COLUMN "uploadKey" TEXT;

CREATE UNIQUE INDEX "Run_uploadKey_key" ON "Run"("uploadKey");
CREATE INDEX "Run_clientId_idx" ON "Run"("clientId");
CREATE INDEX "Run_deviceName_idx" ON "Run"("deviceName");
CREATE INDEX "Run_campaignId_idx" ON "Run"("campaignId");
