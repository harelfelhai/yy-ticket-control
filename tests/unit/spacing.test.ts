import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { chipClasses } from "@/components/ui/chip";
import { SRC, scan, sourceFiles, stripComments } from "./source-scan";

/**
 * ריתמוס 4px — בדיקה על הקוד עצמו, כמו `typography.test.ts`.
 *
 * מה שנשמר כאן אינו אסתטי. ערך של 6px בין תווית לשדה נראה נכון בכל מסך
 * בנפרד; מה שנשבר הוא שהמרווח **אינו זהה** בין מסך למסך, וזה בדיוק מה שהעין
 * קוראת כ"לא מעוצב" בלי לדעת להצביע על הסיבה.
 *
 * הסטייה שהיא מונעת כבר קרתה: 16 מופעים של `gap-1.5`, ומהם 11 היו בכלל
 * `Field` שנכתב מחדש ביד — אותה תבנית של `LearnedSelect`. כלומר המספר החורג
 * היה **סימפטום**, לא המחלה. לכן יש כאן שתי בדיקות ולא אחת: אחת על הערך,
 * ואחת על התבנית שייצרה אותו.
 */

/** `gap-1.5`, `py-0.5`, `mt-2.5` — כל מה שאינו כפולה של 4px */
const FRACTIONAL =
  /\b(gap|gap-x|gap-y|p|px|py|pt|pb|ps|pe|pl|pr|m|mx|my|mt|mb|ms|me|ml|mr|space-x|space-y)-\d+\.\d+\b/;

/** `p-[13px]` — ערך שרירותי עוקף את הסקאלה לגמרי */
const ARBITRARY = /\b(gap|gap-x|gap-y|p|px|py|pt|pb|ps|pe|pl|pr|m|mx|my|mt|mb|ms|me|ml|mr)-\[/;

/**
 * רשימת ההחרגות של הקובץ הזה — כרגע ערך אחד, ומתועד ב-DESIGN.md § Chip:
 * ריפוד אנכי של 4px מנפח את הצ׳יפ עד שהוא שובר את שורת המטא-דאטה בכרטיס.
 * **זו הסיבה שהצ׳יפ הוא רכיב** — החריג נעול בקובץ אחד במקום להתפזר.
 *
 * ההחרגה היא ברמת הקובץ ולא ברמת הכלל, ובכוונה: מנגנון החרגה-לכל-כלל היה
 * הפשטה לתרחיש שאינו קיים. כשיהיה חריג שני מסוג אחר — אז נפצל.
 */
const EXEMPT = ["components/ui/chip.tsx"];

describe("ריתמוס 4px", () => {
  it("אין מרווח שאינו כפולה של 4px", () => {
    const offenders = scan(FRACTIONAL, EXEMPT);
    expect(
      offenders,
      `הסקאלה היא 1(4) 2(8) 3(12) 4(16) 6(24) 8(32) — ראו docs/DESIGN.md § Layout:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("אין ערך מרווח שרירותי", () => {
    const offenders = scan(ARBITRARY, EXEMPT);
    expect(offenders, `ערך שרירותי עוקף את הסקאלה:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("החריג של הצ׳יפ עדיין קיים — אחרת ההחרגה מיותרת ויש למחוק אותה", () => {
    // בלי הבדיקה הזו ההחרגה שורדת גם אחרי שהצורך בה נעלם, ואז היא חור
    // פתוח בגדר במקום חריג מנומק.
    expect(chipClasses()).toMatch(FRACTIONAL);
  });
});

describe("מאפיינים לוגיים", () => {
  /**
   * המערכת היא RTL בלבד, ולכן `mr-2` **עובד** — הוא פשוט מתאר את הכיוון
   * הפיזי במקום את התפקיד. זו הסיבה שהסטייה הזו שורדת: היא לעולם אינה
   * נראית. מה שהיא שוברת הוא הקריאה — `end-4` אומר "בקצה", `left-4` אומר
   * "משמאל", ורק הראשון מסביר למה ה-FAB נמצא שם.
   *
   * ‏`globals.css` אינו נסרק כאן: `.control-chevron` משתמש ב-`padding-left`
   * פיזי בכוונה מתועדת, כי `background-position` אינו מקבל ערך לוגי.
   */
  const PHYSICAL =
    /\b(m[lr]|p[lr]|left|right|inset-[lr]|border-[lr]|rounded-[lr])-[0-9[]|\btext-(left|right)\b/;

  it("אין מחלקה שמתארת כיוון פיזי במקום תפקיד", () => {
    const offenders = scan(PHYSICAL, EXEMPT);
    expect(
      offenders,
      `יש להשתמש ב-ms/me/ps/pe/start/end/text-start:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("תבנית ה-Field", () => {
  /**
   * תווית **מעל** פקד היא `Field`. ‏12 מקומות בנו אותה מחדש ביד, ואחד מהם
   * (`batch-form`) שם `font-medium` על ה-`<label>` עצמו — ומכיוון ש-preflight
   * של Tailwind מגדיר `font: inherit` על פקדי טופס, המשקל דלף לתוך ה-`<input>`
   * ואותו שדה נכתב בבינוני בזמן שכל שאר השדות במערכת נכתבו רגיל.
   *
   * ‏`<label className="flex items-center">` אינו נתפס כאן בכוונה: תיבת סימון
   * עם טקסט לצדה היא תבנית אחרת, ו-`Field` אינו מתאים לה.
   */
  it("אין `<label>` שמערים תווית מעל פקד — לזה יש `Field`", () => {
    const offenders = scan(/<label[^>]*className="[^"]*\bflex-col\b/, ["components/ui/field.tsx"]);

    expect(
      offenders,
      `יש להשתמש ב-<Field label={...}> מ-@/components/ui/field:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * ריתמוס רשימה אנכית — `CARD_LIST` / `ROW_LIST` (DESIGN.md § ריתמוס).
 *
 * **פער 22 נסגר ואז זלג (פער 32).** התיקון הראשון יישר את הלוח ואת מסך
 * התגיות ידנית, בלי אוכף, ולכן חמש רשימות שנכתבו אחריו — שתיים מהן מסכי
 * ניהול שנכתבו באותו סבב וחלוקים ביניהם — חזרו ל-`gap-2`. הלקח החוזר
 * בפרויקט הזה: פער שנסגר בלי אוכף אינו סגור, הוא רק לא נראה כרגע.
 *
 * **הניסיון הראשון שלי כאן היה היוריסטיקה, והיא נכשלה במדידה:** לזהות
 * רשימת כרטיסים לפי `cardClasses` בגוף הרשימה. היא תפסה חמישה מופעים
 * ופספסה שניים — שם ה-`<li>` מרנדר רכיב, וההגדרה יושבת מאה שורות מתחת.
 * לכן הכלל מבני ולא מנחש: **רשימה אנכית מצהירה על תפקידה**, והבחירה בין
 * שני הקבועים היא בדיוק מה שאפשר לסקור.
 */
describe("ריתמוס רשימה אנכית", () => {
  const LITERAL_LIST_GAP = /<(ul|ol)[^>]*flex flex-col gap-\d/;

  /**
   * ‏"נמענים שהוסרו" ב-`gap-1`: רשימה משנית ומקופלת בתחתית הרצועה, שאינה
   * פריטים נפרדים ואינה שורות של פריט — היא הערת שוליים. תפקיד שלישי
   * שאין לו קבוע כי יש לו אתר אחד.
   */
  const EXEMPT_LISTS = ["app/(internal)/tickets/[id]/recipient-editor.tsx"];

  it("רשימה אנכית משתמשת ב-CARD_LIST או ב-ROW_LIST ולא במחלקה ישירה", () => {
    const offenders = scan(LITERAL_LIST_GAP, EXEMPT_LISTS);

    expect(
      offenders,
      `רשימה אנכית מצהירה על תפקידה — CARD_LIST (פריטים נפרדים) או ROW_LIST (שורות בתוך פריט), מ-@/lib/ui:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
