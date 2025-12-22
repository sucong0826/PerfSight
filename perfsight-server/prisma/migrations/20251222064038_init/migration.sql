-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "originalId" INTEGER,
    "title" TEXT NOT NULL,
    "reportDate" DATETIME NOT NULL,
    "release" TEXT,
    "scenario" TEXT,
    "buildId" TEXT,
    "platform" TEXT,
    "browser" TEXT,
    "mode" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "durationSeconds" INTEGER,
    "datasetJson" TEXT NOT NULL,
    "avgCpu" REAL,
    "avgMemMb" REAL,
    "p95Cpu" REAL,
    "p95MemMb" REAL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Run_release_idx" ON "Run"("release");

-- CreateIndex
CREATE INDEX "Run_scenario_idx" ON "Run"("scenario");

-- CreateIndex
CREATE INDEX "Run_buildId_idx" ON "Run"("buildId");

-- CreateIndex
CREATE INDEX "Run_platform_idx" ON "Run"("platform");

-- CreateIndex
CREATE INDEX "Run_createdAt_idx" ON "Run"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Project_token_key" ON "Project"("token");
