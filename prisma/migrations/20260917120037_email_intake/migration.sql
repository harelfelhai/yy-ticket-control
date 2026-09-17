-- פתיחת פנייה במייל (אפיון 1.3, §2.6).
--
-- מיגרציה אחת לכל השלבים, כדי שהסכימה תיכנס לפרודקשן לפני שקוד כלשהו נשען
-- עליה ובלי לשנות התנהגות: הערוץ כבוי עד שמשתנה סביבה מדליק אותו.
--
-- **‏Ticket.siteId הופך nullable, ורק בתנאי אחד.** טיוטה ממייל של מנהל מערכת
-- או בעלים שלא זוהה בה אתר נשמרת בלי אתר (§2.6 שלב 3). כל פנייה אחרת חייבת
-- אתר, כמו עד היום — ולכן ה-CHECK בסוף הקובץ ולא רק שכבת השירות: פנייה
-- משוגרת בלי אתר הייתה נעלמת מכל מנהל עבודה בשקט. Prisma אינו מבטא CHECK;
-- קיומו נבדק ב-`tests/integration/schema.test.ts`.

-- CreateEnum
CREATE TYPE "MailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MailState" AS ENUM ('PENDING', 'DONE', 'SENT', 'SIMULATED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "MailOutcome" AS ENUM ('IGNORED_BEFORE_ACTIVATION', 'IGNORED_OWN_MESSAGE', 'IGNORED_AUTO_REPLY', 'IGNORED_UNAUTHORIZED', 'IGNORED_SUBJECT', 'GONE', 'NO_SITE', 'DRAFT_CREATED', 'DRAFT_CREATED_UNPROCESSED', 'REPLY_APPLIED', 'REPLY_STORED_UNPROCESSED', 'REPLY_NOT_PERMITTED', 'REPLY_AFTER_DISPATCH', 'REPLY_AFTER_DELETION');

-- CreateEnum
CREATE TYPE "DraftFieldName" AS ENUM ('SITE', 'BUILDING', 'APARTMENT', 'ROOM', 'DOMAIN', 'DESCRIPTION', 'RECIPIENTS');

-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "Ticket" ALTER COLUMN "siteId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailIntakeEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "UserEmailAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEmailAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftField" (
    "ticketId" TEXT NOT NULL,
    "field" "DraftFieldName" NOT NULL,
    "fromEmail" BOOLEAN NOT NULL DEFAULT false,
    "systemEditedAt" TIMESTAMP(3),
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "emailValue" JSONB,
    "emailMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftField_pkey" PRIMARY KEY ("ticketId","field")
);

-- CreateTable
CREATE TABLE "MailThread" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxMessage" (
    "id" TEXT NOT NULL,
    "direction" "MailDirection" NOT NULL,
    "state" "MailState" NOT NULL DEFAULT 'PENDING',
    "outcome" "MailOutcome",
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "rfcMessageId" TEXT,
    "inReplyTo" TEXT,
    "referenceIds" TEXT[],
    "threadId" TEXT,
    "repliesToId" TEXT,
    "fromAddress" TEXT,
    "fromName" TEXT,
    "toAddress" TEXT,
    "authorUserId" TEXT,
    "subject" TEXT,
    "bodyText" TEXT,
    "fullText" TEXT,
    "receivedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "report" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "partIndex" INTEGER NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "storageKey" TEXT,
    "isMedia" BOOLEAN NOT NULL,
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "skippedReason" TEXT,
    "mediaFileId" TEXT,
    "removedFromDraftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailChannelState" (
    "channel" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "lastPollAt" TIMESTAMP(3),
    "lastPollOkAt" TIMESTAMP(3),
    "lastPollError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailChannelState_pkey" PRIMARY KEY ("channel")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserEmailAlias_address_key" ON "UserEmailAlias"("address");

-- CreateIndex
CREATE INDEX "UserEmailAlias_userId_idx" ON "UserEmailAlias"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MailThread_ticketId_key" ON "MailThread"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxMessage_gmailMessageId_key" ON "MailboxMessage"("gmailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxMessage_repliesToId_key" ON "MailboxMessage"("repliesToId");

-- CreateIndex
CREATE INDEX "MailboxMessage_threadId_createdAt_idx" ON "MailboxMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "MailboxMessage_state_nextAttemptAt_idx" ON "MailboxMessage"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MailboxMessage_rfcMessageId_idx" ON "MailboxMessage"("rfcMessageId");

-- CreateIndex
CREATE INDEX "MailboxMessage_gmailThreadId_idx" ON "MailboxMessage"("gmailThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxAttachment_storageKey_key" ON "MailboxAttachment"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxAttachment_mediaFileId_key" ON "MailboxAttachment"("mediaFileId");

-- CreateIndex
CREATE INDEX "MailboxAttachment_sha256_idx" ON "MailboxAttachment"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxAttachment_messageId_partIndex_key" ON "MailboxAttachment"("messageId", "partIndex");

-- AddForeignKey
ALTER TABLE "UserEmailAlias" ADD CONSTRAINT "UserEmailAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftField" ADD CONSTRAINT "DraftField_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftField" ADD CONSTRAINT "DraftField_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "MailboxMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailThread" ADD CONSTRAINT "MailThread_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxMessage" ADD CONSTRAINT "MailboxMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MailThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxMessage" ADD CONSTRAINT "MailboxMessage_repliesToId_fkey" FOREIGN KEY ("repliesToId") REFERENCES "MailboxMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxMessage" ADD CONSTRAINT "MailboxMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxAttachment" ADD CONSTRAINT "MailboxAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailboxMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxAttachment" ADD CONSTRAINT "MailboxAttachment_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- פנייה בלי אתר קיימת רק כטיוטה ממייל (§3.2 שדה 3).
-- ‏`channel::text` ולא `channel = 'EMAIL'`: הערך נוסף ל-enum באותה טרנזאקציה,
-- ו-Postgres אוסר שימוש בערך enum חדש לפני שהטרנזאקציה שהוסיפה אותו נסגרה.
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_siteId_required_unless_email_draft"
  CHECK ("siteId" IS NOT NULL OR ("isDraft" AND "channel"::text = 'EMAIL'));
