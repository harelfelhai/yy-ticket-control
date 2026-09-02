import { he } from "@/lib/he";
import { PAGE_X, PANEL_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { ButtonLink } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";

/**
 * מסך 404 — עברית, RTL, ועם דרך חזרה.
 *
 * **הקובץ הזה לא היה קיים עד 1.9.2026 (GAP-A4)**, ולכן כל `notFound()`
 * במערכת נחת על מסך ברירת המחדל של Next: "This page could not be found",
 * באנגלית, בלי ניווט. ‏§4 קובע "שפת הממשק: עברית" ללא חריג.
 *
 * **זה אינו מקרה קצה.** ‏`notFound()` הוא המנגנון שבו המערכת חוסמת גישה:
 * פנייה של אתר אחר, תגית שאינה פתוחה לצופה, מזהה שגוי בכתובת. כלומר
 * המסך הנפוץ ביותר שמשתמש פוגש כשמשהו לא מותר לו — היה באנגלית.
 *
 * הפריסה זהה ל-`ExpiredLink` של הפורטל, ומאותו נימוק: פאנל יחיד ממורכז
 * (`PANEL_WIDTH`), הודעה, והנחיה מה לעשות עכשיו. משתמש שמקבל "אין" בלי
 * המשך מרים טלפון — וזה בדיוק מה שהמערכת נועדה לחסוך.
 */
export default function NotFound() {
  return (
    <main className={`flex flex-1 items-center justify-center py-3 ${PAGE_X}`}>
      <div className={cardClasses(`text-center ${PANEL_WIDTH}`, { padding: "roomy" })}>
        <h1 className={TITLE_DESCRIPTIVE}>{he.errorPage.notFoundTitle}</h1>
        <p className="mt-2 text-muted">{he.errorPage.notFoundHelp}</p>
        <div className="mt-3 flex justify-center">
          <ButtonLink href="/board">{he.errorPage.toBoard}</ButtonLink>
        </div>
      </div>
    </main>
  );
}
