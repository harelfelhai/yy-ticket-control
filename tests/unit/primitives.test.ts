import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, scan, sourceFiles } from "./source-scan";

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
  // ‏`success` ו-`warning` אינם וריאנטים של `Button`, ובכוונה: אתר קריאה
  // אחד לכל אחד. **תיל מתיחה:** אתר שני מכל סוג הוא ההצדקה להוסיף אותו,
  // בדיוק כפי ש-`quiet` נוסף בדיעבד. עד אז — שני כפתורים ידניים בקובץ אחד.
  "app/p/[token]/[ticketId]/portal-actions.tsx":
    "שני כפתורים: 'סיימתי' ב-success ובגובה 56px, ו'יש לי שאלה' ב-warning",
  "app/(internal)/tickets/[id]/resident-name.tsx": "קישור-בשורה בתוך משפט; 44px היה שובר את הכותרת",
};

/**
 * כל `<button>` שנושא מחלקת מראה, מחוץ לחריגים.
 *
 * לא משתמש ב-`scan` המשותף כי הבדיקה כאן חוצה שורות: המחלקות יושבות לרוב
 * על שורה נפרדת מהתגית. הפריסה על הקבצים כן מגיעה משם.
 */
function handRolledButtons(): string[] {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
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

/**
 * ‏`role="status"` ב-`media-picker` מדווח על **התקדמות העלאה**, לא על תוצאת
 * פעולה — הוא `text-muted` ומספר כמה קבצים עולים כרגע. `FormNotice` היה
 * צובע אותו ירוק ומכריז "הצלחה" באמצע הדרך.
 */
const MESSAGE_EXEMPT: Record<string, string> = {
  "components/ui/message.tsx": "הפרימיטיב עצמו — FormError, FormNotice ו-Banner מוגדרים כאן",
  "components/media-picker.tsx": "מונה התקדמות העלאה, לא תוצאת פעולה — text-muted ולא ירוק",
};

describe("פרימיטיב הודעת המצב", () => {
  /**
   * ‏`role=` ולא סריקה על המחלקות: הסריקה עובדת שורה-שורה, ומחלקה עלולה
   * לשבת בשורה נפרדת מהתגית. `role="alert"` יושב תמיד באותה שורה של התגית,
   * ולכן הוא העוגן היחיד שאין ממנו מנוס.
   */
  it("אין הודעת מצב שנכתבת ביד", () => {
    const offenders = scan(/role="(alert|status)"/, Object.keys(MESSAGE_EXEMPT));

    expect(
      offenders,
      `יש להשתמש ב-FormError / FormNotice מ-@/components/ui/field:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("החריג של media-picker עדיין קיים — אחרת יש למחוק אותו", () => {
    // החרגה ששרדה את הצורך בה היא חור בגדר, לא חריג מנומק.
    const source = readFileSync(join(SRC, "components/media-picker.tsx"), "utf8");
    expect(source).toContain('role="status"');
  });
});

describe("טיפול ב-ActionResult", () => {
  /**
   * ‏`if (!x.ok) throw new Error(x.error)` היה כתוב בשישה קבצים, בשלושה
   * שמות שונים (`unwrap`, inline בתוך `onCreate`, ובלוק בתוך `startTransition`).
   * ‏`unwrapOrThrow` ב-`lib/action-result.ts` הוא המקור היחיד.
   */
  it("אין פריקה ידנית של `ActionResult`", () => {
    const offenders = scan(/if \(![\w.]+\.ok\)\s*throw new Error/, ["lib/action-result.ts"]);

    expect(
      offenders,
      `יש להשתמש ב-unwrapOrThrow מ-@/lib/action-result:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("שדה התגובה", () => {
  /**
   * ‏`he.ticket.reply` הוא עוגן מדויק: הוא מופיע **בדיוק** בארבעת מסכי
   * הכתיבה ובשום מקום אחר. סריקה עליו מקבעת את `rows={3}` לתמיד — הערך
   * שכבר סטה פעם אחת ל-2 בצ׳אט התגית.
   */
  it("אין שדה תגובה שנבנה ביד — לזה יש `ReplyField`", () => {
    const offenders = scan(/he\.ticket\.reply\b/, ["components/reply-field.tsx"]);

    expect(
      offenders,
      `יש להשתמש ב-ReplyField מ-@/components/reply-field:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("פרימיטיב שדה התאריך", () => {
  /**
   * ‏`<input type="date">` הוא **חריג מכוון** — אייקון הלוח של הדפדפן אינו
   * מיושר לשאר הפקדים, כי הסתרתו שוברת את היעד שפותח את הבורר בדסקטופ
   * (ראו `FilterDate` ו-DESIGN.md § FilterBar).
   *
   * הבדיקה הזו אינה על שימוש חוזר — שני אתרי קריאה בלבד. היא על כך
   * ש**לחריג יש בית אחד**: חריג שמפוזר אינו חריג אלא סטייה, ואי אפשר
   * לסקור אותו. זה הלקח של `PANEL_WIDTH` — תקן שחסר לו תפקיד נעקף.
   */
  it("אין `type=\"date\"` מחוץ ל-`FilterDate`", () => {
    const offenders = scan(/type="date"/, ["components/ui/filter-bar.tsx"]);

    expect(
      offenders,
      `שדה תאריך עובר דרך FilterDate — שם מתועד חריג הנייטיב:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
