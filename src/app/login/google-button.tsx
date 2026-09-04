import { buttonClasses } from "@/components/ui/button";
import { GOOGLE_START_PATH } from "@/lib/google-oauth";
import { he } from "@/lib/he";

/**
 * המסלול הנוסף במסך ההתחברות (1.2).
 *
 * מוצג רק כששני משתני הסביבה מוגדרים — הבדיקה יושבת אצל הקורא
 * (`isGoogleLoginConfigured`), כדי שהרכיב יישאר טהור.
 */

/**
 * ה-`G` הרשמי, כ-SVG מוטבע.
 *
 * **החריג היחיד לטבלת האייקונים, ומתועד ב-`docs/DESIGN.md` § אייקונים.**
 * ל-`lucide-react` אין סמלי מותג, ו-DESIGN.md אוסר ספריית אייקונים נוספת —
 * כלומר אין דרך שלישית. ארבעת קודי ה-hex הם זהות של צד שלישי ואינם ניתנים
 * למיפוי לטוקן גרפיט; הם אינם נכנסים ל-`globals.css` ואינם חלק מהפלטה.
 *
 * ‏SVG מוטבע ולא תמונה חיצונית: מסך התחברות שתלוי במשיכה מדומיין של צד
 * שלישי הוא מסך שנשבר בקליטה גרועה — בדיוק המצב שבו צריך להתחבר.
 *
 * ‏`aria-hidden` מפני שלכפתור יש טקסט גלוי; השם הנגיש מגיע ממנו.
 */
function GoogleMark() {
  return (
    <svg className="size-3" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

export function GoogleSignIn({ next }: { next?: string }) {
  const href = next
    ? `${GOOGLE_START_PATH}?next=${encodeURIComponent(next)}`
    : GOOGLE_START_PATH;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <p className="text-center text-xs text-muted">{he.login.googleSeparator}</p>

      {/*
       * **‏`<a>` ולא טופס, ולא `ButtonLink`.** שני נימוקים בלתי-תלויים:
       *
       * 1. **CSP.** ‏`form-action 'self'` (`security-headers.ts`) נאכף על **כל
       *    שרשרת ההפניות** שאחרי שיגור טופס, ולא רק על ה-action עצמו. טופס
       *    שמפנה ל-302 אל accounts.google.com נחסם בדפדפן, והחסימה מגיעה
       *    כשגיאת CSP בקונסול — לא כהודעה במסך. ניווט GET אינו כפוף לה.
       * 2. **prefetch.** ‏`next/link` מבקש את היעד מראש, והיעד כאן **כותב
       *    עוגייה ומייצר state**. כלומר prefetch היה פותח זרימה בכל טעינה של
       *    מסך ההתחברות ודורס את ה-state של הזרימה שהמשתמש באמת התחיל.
       *
       * ‏`buttonClasses()` הוא בדיוק המקרה שהוא מתעד (§ Components): המראה
       * על אלמנט שאינו `<button>` ואינו `<Link>`.
       *
       * ‏`secondary` ולא `primary`: `primary` הוא אחת לכל מסך לכל היותר, והיא
       * כבר כפתור "כניסה". `w-full` ו-`gap-2` הם פריסה, וזה כל מה שמותר
       * ב-`className` לפי חוזה הפרימיטיב.
       */}
      <a href={href} className={buttonClasses("secondary", "default", "w-full gap-2")}>
        <GoogleMark />
        {he.login.googleSubmit}
      </a>
    </div>
  );
}
