-- שינוי שם: r2Key → storageKey. השם לא נשא ספק בכוונה — בפיתוח אותו מפתח
-- מצביע על קובץ בדיסק, ובפרודקשן על אובייקט ב-R2.
-- DROP ולא RENAME: הטבלה ריקה בכל הסביבות (המדיה נכנסת ב-M3), ושמירה על
-- ערכים ישנים כאן הייתה משמרת מפתחות שאין להם קובץ מאחוריהם.
DROP INDEX "MediaFile_r2Key_key";

ALTER TABLE "MediaFile" DROP COLUMN "r2Key",
ADD COLUMN     "storageKey" TEXT NOT NULL,
-- הקובץ נרשם לפני שהבתים עלו: ההעלאה נעשית ישירות מהדפדפן לאחסון, ורק אז
-- הלקוח מדווח שהצליחה. רשומה שנשארת false היא העלאה שנקטעה.
ADD COLUMN     "uploaded" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "MediaFile_storageKey_key" ON "MediaFile"("storageKey");
