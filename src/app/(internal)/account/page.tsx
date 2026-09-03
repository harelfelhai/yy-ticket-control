import { cardClasses } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { PAGE_X, PANEL_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: `${he.account.title} — ${he.app.name}` };

/**
 * החשבון האישי — פאנל יחיד ממורכז, כמו מסך ההתחברות.
 *
 * ‏`PANEL_WIDTH` ולא `FULL_WIDTH`: זה אינו מסך שסורקים אלא טופס קצר שממלאים
 * פעם אחת, ורוחב מלא היה פורש שלושה שדות על פני 1920 פיקסלים (§ רוחבי תוכן).
 *
 * המסך פתוח לכל משתמש פנימי ואינו מוגן בהרשאה נוספת: הוא פועל על המשתמש
 * המחובר בלבד, ואין בו מה להסתיר ממנו. `requireUser` נקרא כאן רק כדי להציג
 * את פרטיו — ההגנה עצמה כבר בוצעה ב-layout.
 */
export default async function AccountPage() {
  const user = await requireUser();

  /*
   * ריפוד העמוד מ-`PAGE_X` ולא `p-4` כתוב ביד, כמו בכל שאר המסכים: הקבוע
   * קיים כדי שהריפוד לא ייסחף וכדי ש-`PAGE_BLEED` יישאר צמוד לו (§ ריתמוס).
   * ‏`p-4` נותן 16px מול 12px בכל מסך אחר, ואף שומר אינו תופס את זה —
   * `spacing.test.ts` מקבל אותו כי 16 יושב על סקאלת ה-4.
   *
   * אין `flex justify-center`: ‏`PANEL_WIDTH` כולל `mx-auto` וממרכז את עצמו.
   */
  return (
    <div className={`py-3 ${PAGE_X}`}>
      <div className={cardClasses(PANEL_WIDTH, { padding: "roomy" })}>
        {/*
         * כותרת אחת בלבד. כותרת משנה "החלפת סיסמה" ישבה כאן וירדה: הפאנל
         * מחזיק תוכן יחיד שכותרתו כבר אומרת עליו הכול, וכותרת שנדרשת להיות
         * קטנה כדי לא להתחרות בזו שמעליה אינה כותרת אלא חזרה (§ הסקאלה,
         * נאכף ב-`tests/unit/typography.test.ts`).
         */}
        <h1 className={`mb-1 ${TITLE_DESCRIPTIVE}`}>{he.account.title}</h1>
        <p className="mb-6 text-sm text-muted">
          {user.name} · {he.role[user.role]}
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
