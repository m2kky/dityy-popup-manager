-- CreateTable
CREATE TABLE "PopupEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "popupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "path" TEXT,
    "pageType" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PopupLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "popupId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "path" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PopupEvent_popupId_type_idx" ON "PopupEvent"("popupId", "type");

-- CreateIndex
CREATE INDEX "PopupEvent_createdAt_idx" ON "PopupEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PopupLead_popupId_idx" ON "PopupLead"("popupId");

-- CreateIndex
CREATE INDEX "PopupLead_createdAt_idx" ON "PopupLead"("createdAt");
