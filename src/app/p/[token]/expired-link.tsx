import { he } from "@/lib/he";
import { TITLE_DESCRIPTIVE } from "@/lib/ui";

/**
 * מסך "הקישור אינו בתוקף".
 *
 * מוצג גם לטוקן שגוי, גם לטוקן שבוטל וגם לטוקן שאינו קיים — הודעה אחידה
 * בכוונה, כדי שלא ניתן יהיה להסיק ממנה אילו קישורים קיימים במערכת.
 *
 * הנוסח לקוח מהאפיון כלשונו, ומלווה בהנחיה מה לעשות: קבלן שמקבל "אין
 * גישה" בלי המשך פשוט מתקשר למנהל ושואל, וזה בדיוק מה שהמערכת נועדה
 * לחסוך.
 */
export function ExpiredLink() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center">
        <h1 className={TITLE_DESCRIPTIVE}>{he.portal.expired}</h1>
        <p className="mt-2 text-muted">{he.portal.expiredHelp}</p>
      </div>
    </main>
  );
}
