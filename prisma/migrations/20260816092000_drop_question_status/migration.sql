-- הסרת הערך QUESTION מ-AssignmentStatus (אפיון 0.4, §3.4 / §7 שורה 31).
--
-- שאלה אינה עוד סטטוס של שיוך אלא הודעה רגילה בשרשור. מה שמסמן אותה למנהל
-- הוא דגל נגזר (`deriveAwaitingReply`) ולא עמודה — ולכן הערך אינו נשאר
-- "ליתר ביטחון": ערך enum שאין לו יצרן הוא מצב שאיש אינו יודע איך להגיע
-- אליו, וכל קורא עתידי צריך להוכיח לעצמו שהוא מת.

-- שלב 1: העברת שיוכים קיימים.
--
-- ‏VIEWED ולא SENT: מי ששאל שאלה בהכרח פתח את הפנייה וקרא אותה, ו-SENT היה
-- מוחק את העובדה הזו. השאלה עצמה אינה אובדת — היא נשמרה כהודעה בשרשור
-- (`askQuestionAction` קרא ל-`addMessage` לפני שינוי הסטטוס), ולכן היא
-- ממשיכה להופיע לצד יתר ההודעות.
UPDATE "Assignment" SET "status" = 'VIEWED' WHERE "status" = 'QUESTION';

-- שלב 2: בניית הטיפוס מחדש בלי הערך.
--
-- ‏PostgreSQL אינו יודע להסיר ערך מ-enum קיים; הדרך היחידה היא טיפוס חדש,
-- העברת העמודה אליו, והחלפת השם. ברירת המחדל מוסרת ומוחזרת סביב ההמרה —
-- אחרת ALTER COLUMN TYPE נכשל על ביטוי ברירת מחדל שטיפוסו הישן.
ALTER TYPE "AssignmentStatus" RENAME TO "AssignmentStatus_old";

CREATE TYPE "AssignmentStatus" AS ENUM ('SENT', 'VIEWED', 'DONE', 'REMOVED');

ALTER TABLE "Assignment" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Assignment"
  ALTER COLUMN "status" TYPE "AssignmentStatus"
  USING ("status"::text::"AssignmentStatus");

ALTER TABLE "Assignment" ALTER COLUMN "status" SET DEFAULT 'SENT';

DROP TYPE "AssignmentStatus_old";
