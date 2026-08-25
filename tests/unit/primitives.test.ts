import { readFileSync } from "node:fs";
import { relative } from "node:path";
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
  // הנימוק כאן **התחלף בסבב הצפיפות**, והחילוף עצמו הוא הלקח. הוא דיבר על
  // שורת "צור חדש", שהייתה `border-brand` + `text-brand` — ומאז היא עברה
  // למסגרת מקווקוות ב-`border-fg`, כלומר חדלה להרכיב וריאנט ואינה זקוקה
  // לחריג. מה שכן מרכיב מחלקות מראה ביד הוא **שורת האפשרות**: היא
  // `role="option"` בתוך `listbox` ולא כפתור פעולה, והמילוי הגרפיטי הוא
  // ה-`aria-selected` שנראה בעין. חריג ששרד את הקוד שנימק אותו הוא בדיוק
  // הפתח שדרכו נכנס הבא, ולכן הנימוק מתוקן ולא מוארך.
  "components/learned-select.tsx":
    "שורת אפשרות ב-listbox — role=\"option\" ולא פעולה; המילוי הוא סימון הנבחר",
  "components/media-picker.tsx": "יעד צילום בולט של 64px, גדול מכל וריאנט",
  "components/audio-recorder.tsx": "מראה שמשתנה לפי מצב ההקלטה",
  // ‏**החריג של `portal-actions` נמחק בסבב הצפיפות, וזו הפעם השנייה.**
  // ברשומה ההיא ישבו שני כפתורים: `warning` ("יש לי שאלה") ירד ב-0.4 עם
  // סטטוס QUESTION, ו-`success` ("סיימתי — טופל", 56px, `rounded-xl`) ירד
  // כאן — הכפתור עבר ל-`Button` ב-`primary`. הנימוק המלא בגוף הקובץ;
  // בקצרה: `success` הוא צבע מצב ולא צבע פעולה, ואת בשורת ההצלחה נושא
  // ה-`Banner` שאחרי הלחיצה.
  //
  // מה שנשאר מכך כאן הוא הכלל: **חריגה שמתארת קוד שאינו קיים היא בדיוק מה
  // שמרשה לחריגה הבאה להיכנס בלי דיון**, ולכן היא נמחקת ולא מנוסחת מחדש.
  // ובנגזרת: ל-`Button` אין וריאנט `success`, ועכשיו גם אין לו אתר קריאה
  // אחד — כלומר הבקשה להוסיף אותו מתחילה מאפס ולא מ"הרי כבר יש אחד".
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
 *
 * **ההחרגה היא לתפקיד, לא לקובץ (פער 31).** כשהיא ניתנה לקובץ כולו,
 * ‏`media-picker` החזיק גם העתק תו-בתו של `FormError` — `role="alert"` עם
 * אותן מחלקות בדיוק — והוא חמק בשקט תחת נימוק שמדבר על משהו אחר. החרגה
 * רחבה מנימוקה היא חור בגדר, לא חריג מנומק.
 */
const STATUS_EXEMPT: Record<string, string> = {
  "components/ui/message.tsx": "הפרימיטיב עצמו — FormError, FormNotice, Banner ו-UploadingNotice",
};

/** ל-`role="alert"` יש בית אחד בלבד: `FormError`. אין חריגים. */
const ALERT_EXEMPT: Record<string, string> = {
  "components/ui/message.tsx": "הפרימיטיב עצמו — FormError מוגדר כאן",
};

describe("פרימיטיב הודעת המצב", () => {
  /**
   * ‏`role=` ולא סריקה על המחלקות: הסריקה עובדת שורה-שורה, ומחלקה עלולה
   * לשבת בשורה נפרדת מהתגית. `role="alert"` יושב תמיד באותה שורה של התגית,
   * ולכן הוא העוגן היחיד שאין ממנו מנוס.
   */
  it("אין הודעת שגיאה שנכתבת ביד", () => {
    const offenders = scan(/role="alert"/, Object.keys(ALERT_EXEMPT));

    expect(
      offenders,
      `יש להשתמש ב-FormError מ-@/components/ui/message:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("אין הודעת מצב שנכתבת ביד", () => {
    const offenders = scan(/role="status"/, Object.keys(STATUS_EXEMPT));

    expect(
      offenders,
      `יש להשתמש ב-FormNotice מ-@/components/ui/message:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  /**
   * **החריג של `media-picker` נמחק ב-0.6, וזו הבדיקה שהחליפה אותו.**
   *
   * הבדיקה הקודמת שמרה על החריג עצמו ("החרגה ששרדה את הצורך בה היא חור
   * בגדר"), והצורך אכן נעלם: חיווי ההעלאה עבר ל-`UploadingNotice`, ולקובץ
   * אין עוד `role="status"` משלו. חריג שמתאר קוד שאינו קיים הוא בדיוק מה
   * שמרשה לחריג הבא להיכנס בלי דיון — ולכן הוא נמחק ולא נוסח מחדש.
   *
   * מה שהחליף אותו שומר על אותו דבר עצמו בכיוון החיובי: החיווי מרוכז,
   * ואיש אינו מרכיב אותו מחדש משלוש שורות.
   */
  it("אין חיווי העלאה שנבנה ביד — לזה יש `UploadingNotice`", () => {
    const offenders = scan(/he\.media\.uploading\b/, ["components/ui/message.tsx"]);

    expect(
      offenders,
      `יש להשתמש ב-UploadingNotice מ-@/components/ui/message:\n${offenders.join("\n")}`,
    ).toEqual([]);
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

/**
 * אייקון שהחליף תווית חייב להשאיר שם נגיש.
 *
 * **זה האינווריאנט שכל סבב הצ׳אט תלוי בו.** ארבעה כפתורים איבדו את הטקסט
 * הגלוי שלהם ("צרף קובץ", "צלם", "הקלט", "שלח") — ואם `aria-label` אינו
 * נושא בדיוק את אותה מחרוזת, שני דברים נשברים בבת אחת: קורא מסך מכריז
 * "כפתור" בלי לומר איזה, וכל `getByRole("button", { name: ... })` בחבילות
 * ה-e2e מפסיק למצוא אותו.
 *
 * הכשל הזה **שקט בשני הכיוונים**: הכפתור נראה תקין בצילום, והבדיקה שנשברת
 * מדווחת "לא נמצא אלמנט" ולא "חסרה נגישות". לכן הוא נאכף כאן.
 *
 * **הבדיקה רחבה מ"אייקון בלבד", ובכוונה.** היא מסמנת כל אייקון בתוך כפתור
 * שאין עליו `aria-label` — גם כשיש טקסט גלוי לצדו, כמו בכניסות של גיליון
 * הצירוף. הניסוח הצר היה דורש לזהות "האם יש כאן גם טקסט", וזו שאלה
 * שסריקת מחרוזת אינה יכולה לענות עליה בלי היוריסטיקה. התגובה הנכונה
 * להסתמנות היא **להוסיף את התווית** (זהה לטקסט הגלוי), לא להחליש את האוכף
 * — בדיוק הלקח מפער 33, שם אוכף שנוסח רחב מדי נמחק בסבב הבא.
 *
 * הספציפיקציה: `docs/DESIGN.md` § אייקונים.
 */
describe("אייקון בכפתור", () => {
  /** האייקונים שהמערכת מכירה (§ אייקונים — הטבלה שם היא המקור) */
  const ICONS = /<(Paperclip|Camera|Mic|Send|X|Plus)\b/;

  it("כל אייקון בתוך כפתור נושא `aria-label`", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).replaceAll("\\", "/");
      const lines = readFileSync(file, "utf8").split("\n");

      lines.forEach((line, index) => {
        if (!ICONS.test(line)) return;

        /*
         * **חיפוש לאחור עד שנמצא כפתור, ולא חלון בגודל קבוע.**
         *
         * הגרסה הראשונה של הבדיקה הזו הסתכלה שמונה שורות אחורה ו-`return`
         * כשלא מצאה — ובפועל **דילגה על מחצית המקרים**: כפתור השליחה נושא
         * ‏`onClick` שנפרש על עשר שורות, וכפתור ההקלטה הוא `<button>` ידני
         * עם הערת נימוק מעליו. היא עברה בירוק ולא בדקה דבר.
         *
         * ‏40 שורות ולא 8, שני סוגי התגית, ו**אייקון שאינו בתוך כפתור כלל
         * נחשב הפרה** — הוא או חסר שם נגיש, או יושב במקום שדורש מבט.
         */
        const before = lines.slice(Math.max(0, index - 40), index).join("\n");
        const tag = Math.max(before.lastIndexOf("<Button"), before.lastIndexOf("<button"));

        if (tag === -1) {
          offenders.push(`${rel}:${index + 1} — אייקון מחוץ לכפתור`);
          return;
        }
        if (!/aria-label=/.test(before.slice(tag))) {
          offenders.push(`${rel}:${index + 1} — כפתור בלי aria-label`);
        }
      });
    }

    expect(
      offenders,
      `אייקון בלי שם נגיש — יש להוסיף aria-label מ-@/lib/he:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("שדה התגובה", () => {
  /**
   * ‏`he.ticket.reply` הוא עוגן מדויק: ארבעת מסכי הכתיבה מרנדרים את השדה
   * דרך `ReplyField`, והמחרוזת מופיעה בו ורק בו.
   *
   * **מה שהעוגן מקבע השתנה בסבב הצ׳אט, והנימוק שלו לא.** קודם הוא קיבע את
   * ‏`rows={3}` — הערך שכבר סטה פעם אחת ל-2 בצ׳אט התגית. היום הגובה דינמי
   * ואין מספר לסטות ממנו, אבל **יש חריג**: המחרוזת ירדה מתווית גלויה
   * ל-`aria-label` (DESIGN.md § Field, חריג שני). חריג שמשוכפל לארבעה
   * קבצים מפסיק להיות חריג ונעשה נוהג, וזה בדיוק מה שהסריקה מונעת.
   */
  it("אין שדה תגובה שנבנה ביד — לזה יש `ReplyField`", () => {
    const offenders = scan(/he\.ticket\.reply\b/, ["components/reply-field.tsx"]);

    expect(
      offenders,
      `יש להשתמש ב-ReplyField מ-@/components/reply-field:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * שני מסכים מריצים כמה פעולות ברצף בתוך מעבר אחד, עם יציאה מוקדמת ביניהן
 * ועם דגל שמירה מקומית שיש להחזיר לאחור בכשל. הם עוברים דרך ה-hook — ולכן
 * `busy` ו-`error` נשארים במקום אחד — אבל לא דרך `run`.
 *
 * הרשימה מכוונת להיות **קשה להארכה**: להוסיף אליה פירושו לטעון שהזרימה אינה
 * פעולה בודדת, ולא שנוח לכתוב אותה ביד.
 */
const START_ALLOWED: Record<string, string> = {
  "app/(internal)/tickets/new/create-ticket-form.tsx":
    "שיגור עם נפילה חזרה לטיוטה מקומית: try/catch על כשל רשת, וניסיון חוזר באירוע online",
  "app/(internal)/tickets/[id]/draft-completion.tsx":
    "שיגור דו-שלבי — שמירת שדות ואז שיגור — עם החזרת דגל השמירה לאחור בכשל",
};

describe("hook הפעולה", () => {
  /**
   * ‏`useTransition` הוא העוגן, ולא `busy` או `error`: הוא היבוא שאי אפשר
   * לכתוב את התבנית בלעדיו, והוא יושב תמיד בשורת ה-`import` ובשורת השימוש.
   *
   * מה שהוא מונע כבר קרה: `tag-access-control` ויתר על בדיקת ה-hydration
   * לגמרי, ושני קבצים נעלו את הממשק על `pending` בלבד — כלומר שלוש גרסאות
   * שונות של "מתי הכפתור מושבת" בתוך אותה מערכת.
   */
  it("אין `useTransition` מחוץ ל-`lib/use-action.ts`", () => {
    const offenders = scan(/\buseTransition\b/, ["lib/use-action.ts"]);

    expect(
      offenders,
      `הפעלת Server Action עוברת דרך useAction מ-@/lib/use-action:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  /**
   * ‏"מתי הממשק נעול" מוגדר במקום אחד — והגבול עובר בין **מסך** לבין
   * **פרימיטיב קלט משותף**.
   *
   * מסך מחזיק את הפעולה, ולכן `busy` שלו מגיע מ-`useAction`. פרימיטיב קלט
   * אינו קורא ל-Server Action כלל: הוא מקבל `disabled` מההורה או הבטחה
   * מוזרקת שזורקת בכשל, ומה שנשאר לו הוא תנאי ה-hydration לבדו.
   *
   * הבדיקה סורקת את `!hydrated` ולא את `pending || !hydrated`, וזה ההבדל
   * שגילה את הווריאנט הרביעי: `professional-create-form` בנה `saving ||
   * !hydrated` על `useState` ידני, ולכן חמק גם מהסריקה על `useTransition`
   * וגם מהניסוח הצר.
   */
  const HYDRATION_EXEMPT: Record<string, string> = {
    "lib/use-action.ts": "המקור — כאן `busy` מוגדר, וממנו הוא מגיע לכל מסך",
    "components/recipient-picker.tsx": "פרימיטיב קלט; ההוספה מקומית וה-action יושב אצל ההורה",
    "components/learned-select.tsx": "פרימיטיב קלט; `onCreate` מוזרק מההורה וזורק בכשל",
    // ‏0.6: החריג עבר מ-`media-picker` ל-hook שחולץ ממנו. הוא **החליף** את
    // הרשומה ולא נוסף לה — פיצול `!hydrated` בין ה-hook לשני צרכניו היה
    // דורש שלוש רשומות במקום אחת, כלומר חריגה מהתקרה של שש.
    "lib/use-media-upload.ts": "העלאה ל-R2 ולא Server Action — `busy` שלו הוא `disabled` של ההורה",
    "components/professional-create-form.tsx":
      "טופס מוצג בלבד: `onCreate` מוזרק מההורה וזורק, ולכן אין כאן `ActionResult` לפרוק",
  };

  it("‏`!hydrated` מחוץ ל-`useAction` שמור לפרימיטיבים משותפים", () => {
    const offenders = scan(/!hydrated/, Object.keys(HYDRATION_EXEMPT));

    expect(
      offenders,
      `"מתי הממשק נעול" הוא busy מ-useAction; מסך אינו מרכיב אותו ביד:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("רשימת הפרימיטיבים קצרה, וכל אחד מנומק", () => {
    expect(Object.keys(HYDRATION_EXEMPT).length).toBeLessThanOrEqual(6);
    for (const reason of Object.values(HYDRATION_EXEMPT)) expect(reason.length).toBeGreaterThan(20);
  });

  it("פתח המילוט `start` שמור לזרימות רב-שלביות מוצהרות", () => {
    const offenders = scan(/\bstart\b[^;]*=\s*useAction\(/, Object.keys(START_ALLOWED));

    expect(
      offenders,
      `פעולה בודדת מופעלת ב-run ולא ב-start; זרימה רב-שלבית דורשת חריג מנומק:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("רשימת פתח המילוט קצרה, וכל חריג מנומק", () => {
    expect(Object.keys(START_ALLOWED).length).toBeLessThanOrEqual(3);
    for (const reason of Object.values(START_ALLOWED)) expect(reason.length).toBeGreaterThan(20);
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
