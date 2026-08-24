import { he } from "@/lib/he";
import { PAGE_X, PANEL_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";

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
  // ריפוד העמוד מגיע מ-`PAGE_X` כמו בכל מסך אחר; המרחב שהפאנל צריך יושב
  // בריפוד `roomy` שלו עצמו, ולא בריפוד של העמוד שמאחוריו.
  return (
    <main className={`flex flex-1 items-center justify-center py-3 ${PAGE_X}`}>
      <div className={cardClasses(`text-center ${PANEL_WIDTH}`, { padding: "roomy" })}>
        <h1 className={TITLE_DESCRIPTIVE}>{he.portal.expired}</h1>
        <p className="mt-2 text-muted">{he.portal.expiredHelp}</p>
      </div>
    </main>
  );
}
