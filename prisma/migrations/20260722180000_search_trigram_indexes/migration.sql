-- אינדקסים לחיפוש החופשי (אפיון §3.6, מסך 9).
--
-- ‏pg_trgm מפרק טקסט לשלשות תווים ומאנדקס אותן, וכך אינדקס GIN יכול לשרת
-- גם `ILIKE '%מילה%'` — שאילתה שאינדקס B-tree רגיל אינו יכול לעזור לה
-- כלל, כי היא אינה מתחילה בתחילת המחרוזת. בלי זה כל חיפוש היה סורק את
-- כל השורות בכל אחת מארבע הטבלאות.
--
-- ‏trgm ולא tsvector (חיפוש טקסט מלא): ל-Postgres אין stemmer לעברית,
-- ולכן חיפוש טקסט מלא לא היה מזהה נטיות ("נזילה" מול "נזילות") טוב יותר
-- מהתאמת תת-מחרוזת — ובתמורה היה מוסיף עמודה מחושבת וטריגרים לתחזק.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Ticket_description_trgm"
  ON "Ticket" USING gin ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Message_text_trgm"
  ON "Message" USING gin ("text" gin_trgm_ops);

-- התמלול והטקסט המחולץ הם מה שהופך את המדיה לניתנת לחיפוש, וזו כל הסיבה
-- שעיבוד ה-AI קיים.
CREATE INDEX IF NOT EXISTS "MediaFile_transcription_trgm"
  ON "MediaFile" USING gin ("transcription" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "MediaFile_extractedText_trgm"
  ON "MediaFile" USING gin ("extractedText" gin_trgm_ops);
