-- AlterTable
ALTER TABLE "AccessToken" ADD COLUMN     "tokenCipher" TEXT;

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "notifiedAt" TIMESTAMP(3);
