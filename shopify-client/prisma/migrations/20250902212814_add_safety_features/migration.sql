-- CreateTable
CREATE TABLE "SafetyAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT,
    "shop" TEXT NOT NULL,
    "checkResult" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "riskLevel" TEXT NOT NULL,
    "warningsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dismissedAt" DATETIME,
    "dismissedBy" TEXT,
    "resolvedAt" DATETIME,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "SafetyCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "isSafe" BOOLEAN NOT NULL,
    "checkedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WebhookError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SafetyAlert_shop_status_idx" ON "SafetyAlert"("shop", "status");

-- CreateIndex
CREATE INDEX "SafetyAlert_productId_shop_idx" ON "SafetyAlert"("productId", "shop");

-- CreateIndex
CREATE INDEX "SafetyAlert_createdAt_idx" ON "SafetyAlert"("createdAt");

-- CreateIndex
CREATE INDEX "SafetyCheck_shop_checkedAt_idx" ON "SafetyCheck"("shop", "checkedAt");

-- CreateIndex
CREATE INDEX "SafetyCheck_productId_shop_idx" ON "SafetyCheck"("productId", "shop");

-- CreateIndex
CREATE INDEX "WebhookError_shop_createdAt_idx" ON "WebhookError"("shop", "createdAt");
