-- מסך 17 (W5): "נתק" מוחק את ההרשאה השמורה, ולכן הטוקן אינו חובה
ALTER TABLE "WaNumber" ALTER COLUMN "tokenCipher" DROP NOT NULL;

-- מסך 17: ההודעה האחרונה שהתקבלה, והודעת הבדיקה האחרונה שנשלחה
CREATE INDEX "WaMessage_numberId_direction_createdAt_idx" ON "WaMessage"("numberId", "direction", "createdAt");
