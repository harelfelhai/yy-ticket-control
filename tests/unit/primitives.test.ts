import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * שמירה על פרימיטיב הכפתור.
 *
 * הבדיקה קיימת מפני ש"הפער נסגר" נאמר כאן פעמיים ולא היה נכון. בסבב הראשון
 * הוגרו 26 אתרי קריאה והפער סומן ✅; סבב צילומים מאוחר יותר מצא **16 כפתורים
 * נוספים** שנכתבו ביד, ובהם כבר הייתה סטייה בפועל — `disabled:opacity-40`
 * במקום 60, ו-40px במקום 44px.
 *
 * ההבדל בין הצהרה לאכיפה הוא הקובץ הזה: מרגע שהוא קיים, כפתור חדש שנכתב
 * ביד נכשל בבנייה במקום להתגלות בצילום כעבור חודשיים.
 */

const SRC = join(process.cwd(), "src");

/** מחלקות שמסגירות כפתור שמסוגנן ביד ולא דרך `Button` */
const VARIANT_CLASS =
  /\b(bg-brand|bg-danger|bg-success|bg-surface|border-border|border-danger|text-brand|text-danger)\b/;

/**
 * חריגים מכוונים — כפתורים שאינם וריאנט של `Button`, וכל אחד מהם עם הסיבה.
 *
 * הרשימה מכוונת להיות **קצרה וקשה להארכה**: להוסיף אליה פירושו לטעון
 * שהמקרה אינו כפתור, ולא שנוח לכתוב אותו ביד.
 */
const EXEMPT: Record<string, string> = {
  "components/ui/filter-bar.tsx": "מתג גילוי (disclosure) ולא פעולה — נושא aria-expanded",
  "components/ui/button.tsx": "הפרימיטיב עצמו — הוא המקום שבו המחלקות מוגדרות",
  "components/learned-select.tsx": "פריט 'צור חדש' בתוך listbox — מסגרת מקווקוות בכוונה",
  "components/media-picker.tsx": "יעד צילום בולט של 64px, גדול מכל וריאנט",
  "components/audio-recorder.tsx": "מראה שמשתנה לפי מצב ההקלטה",
  "app/p/[token]/[ticketId]/portal-actions.tsx": "פעולת סיום בפורטל בצבע success",
  "app/(internal)/tickets/[id]/resident-name.tsx": "קישור-בשורה בתוך משפט; 44px היה שובר את הכותרת",
};

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** כל `<button>` שנושא מחלקת מראה, מחוץ לחריגים */
function handRolledButtons(): string[] {
  const offenders: string[] = [];

  for (const file of tsxFiles(SRC)) {
    const rel = relative(SRC, file).replaceAll("\\", "/");
    if (rel in EXEMPT) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!/<button\b/.test(line)) return;
      // המחלקות יושבות על שורה נפרדת מהתגית עצמה — סורקים את גוף התגית.
      const body = lines.slice(index, index + 8).join(" ");
      const attrs = body.slice(0, body.indexOf(">") + 1 || body.length);
      if (VARIANT_CLASS.test(attrs)) offenders.push(`${rel}:${index + 1}`);
    });
  }
  return offenders;
}

describe("פרימיטיב הכפתור", () => {
  it("אף כפתור אינו מרכיב מחדש וריאנט מהמחלקות", () => {
    const offenders = handRolledButtons();

    expect(
      offenders,
      `יש להשתמש ב-Button מ-@/components/ui/button, או להוסיף חריג מנומק ל-EXEMPT:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("רשימת החריגים קצרה, וכל חריג מנומק", () => {
    // גבול רך שנועד להיות מורגש: חריג שביעי דורש החלטה, לא הוספת שורה.
    expect(Object.keys(EXEMPT).length).toBeLessThanOrEqual(8);
    for (const reason of Object.values(EXEMPT)) expect(reason.length).toBeGreaterThan(15);
  });
});
