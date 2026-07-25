-- AlterTable
ALTER TABLE "MediaFile" ADD COLUMN     "uploaderProfessionalId" TEXT,
ADD COLUMN     "uploaderUserId" TEXT;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_uploaderProfessionalId_fkey" FOREIGN KEY ("uploaderProfessionalId") REFERENCES "Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;
