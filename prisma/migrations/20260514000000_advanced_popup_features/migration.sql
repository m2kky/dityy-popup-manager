-- AlterTable
ALTER TABLE "PopupEvent" ADD COLUMN "variant" TEXT;
ALTER TABLE "PopupEvent" ADD COLUMN "action" TEXT;

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

