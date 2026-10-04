-- פתיחת פנייה בוואטסאפ (אפיון 1.4, §2.7).
--
-- מיגרציה אחת לכל השלבים, כדי שהסכימה תיכנס לפרודקשן לפני שקוד כלשהו נשען
-- עליה ובלי לשנות התנהגות: הערוץ כבוי עד שמשתנה סביבה מדליק אותו, ואין עדיין
-- קוד שכותב לטבלאות החדשות.
--
-- **יומן נפרד מזה של המייל** (`WaMessage` ולא שורות ב-`MailboxMessage`) — ראו
-- ההערה בסכימה. הטיפוסים "MailDirection" ו-"MailState" משותפים לשני היומנים;
-- ב-Prisma הם נקראים `MessageDirection` ו-`MessageState` (`@@map`), בלי שינוי כאן.
--
-- **ה-CHECK על `Ticket.siteId` מוחלף, ולא רק מורחב.** טיוטה מוואטסאפ של מנהל
-- מערכת או בעלים שלא זוהה בה אתר נשמרת בלי אתר (§2.7 שלב 3), בדיוק כמו במייל;
-- האילוץ הקודם התיר זאת לערוץ `EMAIL` בלבד, והיה דוחה אותה במסד. שם האילוץ
-- משתנה כדי שיתאר מה הוא אוכף. Prisma אינו מבטא CHECK; קיומו נבדק ב-
-- `tests/integration/schema.test.ts`.

-- CreateEnum
CREATE TYPE "WaOutcome" AS ENUM ('IGNORED_DISABLED', 'IGNORED_BEFORE_ACTIVATION', 'IGNORED_ECHO', 'IGNORED_UNSUPPORTED', 'IGNORED_UNAUTHORIZED', 'IGNORED_UNIDENTIFIED', 'IGNORED_NO_KEYWORD', 'NO_SITE', 'DRAFT_CREATED', 'DRAFT_CREATED_UNPROCESSED', 'REPLY_APPLIED', 'REPLY_STORED_UNPROCESSED', 'REPLY_NOT_PERMITTED', 'REPLY_AFTER_DISPATCH', 'REPLY_AFTER_DELETION');

-- CreateEnum
CREATE TYPE "WaNumberStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- AlterTable
ALTER TABLE "DraftField" ADD COLUMN     "waMessageId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "whatsappIntakeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsappUserId" TEXT;

-- CreateTable
CREATE TABLE "WaNumber" (
    "id" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "displayPhone" TEXT NOT NULL,
    "verifiedName" TEXT,
    "tokenCipher" TEXT NOT NULL,
    "coexistence" BOOLEAN NOT NULL DEFAULT false,
    "status" "WaNumberStatus" NOT NULL DEFAULT 'CONNECTED',
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectedById" TEXT,
    "contactsSyncedAt" TIMESTAMP(3),
    "historySyncedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaWebhookEvent" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body" TEXT,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WaWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaThread" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "hintSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "direction" "MailDirection" NOT NULL,
    "state" "MailState" NOT NULL DEFAULT 'PENDING',
    "outcome" "WaOutcome",
    "shadow" BOOLEAN NOT NULL DEFAULT false,
    "numberId" TEXT NOT NULL,
    "wamid" TEXT,
    "waId" TEXT,
    "bsuid" TEXT,
    "profileName" TEXT,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "contextWamid" TEXT,
    "forwarded" BOOLEAN NOT NULL DEFAULT false,
    "threadId" TEXT,
    "repliesToId" TEXT,
    "authorUserId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "errorCode" INTEGER,
    "report" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMedia" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "partIndex" INTEGER NOT NULL DEFAULT 0,
    "waMediaId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "filename" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "voice" BOOLEAN NOT NULL DEFAULT false,
    "transcript" TEXT,
    "storageKey" TEXT,
    "isMedia" BOOLEAN NOT NULL DEFAULT false,
    "skippedReason" TEXT,
    "mediaFileId" TEXT,
    "removedFromDraftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_whatsappUserId_key" ON "User"("whatsappUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WaNumber_phoneNumberId_key" ON "WaNumber"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WaWebhookEvent_processedAt_receivedAt_idx" ON "WaWebhookEvent"("processedAt", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaThread_ticketId_key" ON "WaThread"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_wamid_key" ON "WaMessage"("wamid");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_repliesToId_key" ON "WaMessage"("repliesToId");

-- CreateIndex
CREATE INDEX "WaMessage_authorUserId_state_idx" ON "WaMessage"("authorUserId", "state");

-- CreateIndex
CREATE INDEX "WaMessage_state_nextAttemptAt_idx" ON "WaMessage"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WaMessage_contextWamid_idx" ON "WaMessage"("contextWamid");

-- CreateIndex
CREATE INDEX "WaMessage_threadId_createdAt_idx" ON "WaMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "WaMessage_outcome_receivedAt_idx" ON "WaMessage"("outcome", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaMedia_storageKey_key" ON "WaMedia"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "WaMedia_mediaFileId_key" ON "WaMedia"("mediaFileId");

-- CreateIndex
CREATE INDEX "WaMedia_sha256_idx" ON "WaMedia"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "WaMedia_messageId_partIndex_key" ON "WaMedia"("messageId", "partIndex");

-- AddForeignKey
ALTER TABLE "DraftField" ADD CONSTRAINT "DraftField_waMessageId_fkey" FOREIGN KEY ("waMessageId") REFERENCES "WaMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaNumber" ADD CONSTRAINT "WaNumber_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaThread" ADD CONSTRAINT "WaThread_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WaNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WaThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_repliesToId_fkey" FOREIGN KEY ("repliesToId") REFERENCES "WaMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMedia" ADD CONSTRAINT "WaMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WaMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMedia" ADD CONSTRAINT "WaMedia_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- פנייה בלי אתר קיימת רק כטיוטה מערוץ קליטה — מייל או וואטסאפ (§3.2 שדה 3).
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_siteId_required_unless_email_draft";

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_siteId_required_unless_channel_draft"
  CHECK ("siteId" IS NOT NULL OR ("isDraft" AND "channel"::text IN ('EMAIL', 'WHATSAPP')));
