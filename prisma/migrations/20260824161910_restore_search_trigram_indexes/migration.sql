-- החזרת אינדקסי החיפוש החופשי (אפיון §3.6, מסך 9).
--
-- **מיגרציה שמתקנת מחיקה בשוגג.** ארבעת האינדקסים נוצרו במקור ב-
-- ‏`20260722180000_search_trigram_indexes`, ונמחקו יומיים אחר כך ב-
-- ‏`20260724054950_add_rate_limit` — מיגרציה שכל תוכנה היה הוספת טבלת
-- ‏`RateLimit`. הסיבה: הם נוצרו ב-SQL גולמי ולא הוצהרו ב-`schema.prisma`,
-- ולכן ההשוואה של Prisma מול בסיס הנתונים סיווגה אותם כעודפים.
--
-- מאז 24.7.2026 כל חיפוש במערכת היה `Seq Scan` על ארבע טבלאות. שום בדיקה
-- לא נכשלה, מפני שלא הייתה בדיקה שבודקת קיום אינדקס.
--
-- **התיקון האמיתי אינו כאן אלא ב-`schema.prisma`:** ארבעתם מוצהרים שם
-- עכשיו כ-`@@index([...], type: Gin, ops: raw("gin_trgm_ops"))`. הקובץ הזה
-- רק מיישם את ההצהרה. אינדקס שאינו מוצהר חשוף לאותה מחיקה בכל מיגרציה
-- עתידית, בכל נושא שהוא — ולכן ההצהרה היא מה שמונע חזרה, ולא ה-SQL.
--
-- ‏`pg_trgm` מפרק טקסט לשלשות תווים ומאנדקס אותן, וכך GIN משרת גם
-- ‏`ILIKE '%מילה%'` — שאילתה שאינדקס B-tree אינו יכול לעזור לה כלל, כי היא
-- אינה מתחילה בתחילת המחרוזת.
--
-- ‏trgm ולא tsvector (חיפוש טקסט מלא): ל-Postgres אין stemmer לעברית, ולכן
-- חיפוש טקסט מלא לא היה מזהה נטיות ("נזילה" מול "נזילות") טוב יותר מהתאמת
-- תת-מחרוזת — ובתמורה היה מוסיף עמודה מחושבת וטריגרים לתחזק.

-- התוסף כבר מותקן בסביבות הקיימות; השורה קיימת כדי שהמיגרציה תעמוד בפני
-- עצמה גם על בסיס נתונים נקי, בלי להישען על סדר ההרצה של מיגרציה קודמת.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "MediaFile_transcription_idx" ON "MediaFile" USING GIN ("transcription" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "MediaFile_extractedText_idx" ON "MediaFile" USING GIN ("extractedText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Message_text_idx" ON "Message" USING GIN ("text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Ticket_description_idx" ON "Ticket" USING GIN ("description" gin_trgm_ops);
