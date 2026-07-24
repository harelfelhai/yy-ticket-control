-- DropIndex
DROP INDEX "MediaFile_extractedText_trgm";

-- DropIndex
DROP INDEX "MediaFile_transcription_trgm";

-- DropIndex
DROP INDEX "Message_text_trgm";

-- DropIndex
DROP INDEX "Ticket_description_trgm";

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
