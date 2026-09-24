import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * הרצת `seed-email.ts` מתוך spec — אותה תבנית כמו `seed-archive.ts`: סקריפט
 * נפרד עם `DATABASE_URL` של בסיס ה-E2E, כי ייבוא `db` בתוך spec היה נקשר
 * לבסיס הפיתוח של הסביבה.
 *
 * הזריעה **מאפסת** את התרחישים שלה (מוחקת ויוצרת מחדש), ולא רק מדלגת אם הם
 * קיימים: הבדיקות מכריעות סתירה ומסירות קובץ, ופרויקט הדסקטופ שרץ אחרי
 * המובייל חייב לקבל טיוטה שהסתירה בה עדיין פתוחה. זה בטוח כי ה-workers
 * סדרתיים (`workers: 1`) — אין spec אחר שמחזיק את הטיוטה באותו רגע.
 */
export interface EmailSeed {
  /** טיוטה ממייל: תיאור ותחום מהמייל, סתירה על הבניין, קובץ בטיוטה */
  draftId: string;
  /** פנייה ממייל שכבר שוגרה — ההתכתבות שלה בחלון "פרטים" (EM-S2-01) */
  dispatchedId: string;
  /** טיוטה ממייל בלי אתר — מסלול "בחר אתר תחילה" (§5.ז) */
  noSiteId: string;
}

/** גוף המייל הראשון של הטיוטה — מקופל במסך, כי הוא אינו האחרון */
export const FIRST_BODY = "יש נזילה מהתקרה במטבח, כנראה מהדירה מעל";
/** גוף התשובה של השולח — הוא שהציע בניין אחר; מקופל, כי אחריו יצא מייל חוזר */
export const REPLY_BODY = "טעות שלי, זה בבניין ב ולא בבניין א";
/**
 * המייל החוזר על התשובה — **האחרון** בהתכתבות, ולכן הפתוח. כך הצינור משאיר
 * את השרשרת: על כל תשובה שנקלטה יוצא מייל חוזר, באותה טרנזאקציה.
 */
export const REPLY_ACK_BODY = "עודכן מהתשובה שלך: בניין. יש סתירה בין המייל למערכת, וההכרעה תיעשה במערכת.";
/** תיאור הטיוטה בלי אתר */
export const NO_SITE_BODY = "נפל אריח בחדר המדרגות";
/** מייל חוזר על תשובה שהגיעה אחרי השיגור — אינו חלק מההתכתבות שבחלון "פרטים" */
export const LATE_REPLY = "פנייה כבר נשלחה לנמענים, ולכן התשובה הזו לא שינתה בה דבר.";
/** התיאור של הפנייה ששוגרה — זה מה שהשרשור מציג כהודעה הפותחת */
export const DISPATCHED_DESCRIPTION = "לוח החשמל בכניסה מקרטע";
/** גוף המייל של הפנייה ששוגרה — בהתכתבות בלבד */
export const DISPATCHED_BODY = "התקלה בלוח החשמל בכניסה, מקרטע מאז אתמול";
/** המייל החוזר של הפנייה ששוגרה — אסור שיופיע בשרשור, רק בחלון "פרטים" */
export const DISPATCHED_REPLY = "כל הפרטים זוהו. כדי לשלוח את הפנייה לנמענים: (קישור)";
export const MEDIA_NAME = "logo.png";
export const NON_MEDIA_NAME = "quote.xlsx";
/**
 * קובץ שמנהל צירף בשרשור של הטיוטה, מתוך המערכת — אינו מהמייל, ולכן אינו
 * ברשימת "קבצים בטיוטה" ואין לו "הסר קובץ" (§7 שורה 87)
 */
export const THREAD_FILE_NAME = "plan.pdf";

export function seedEmail(): EmailSeed {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const result = spawnSync(
    process.execPath,
    [require.resolve("tsx/cli"), path.join("e2e", "seed-email.ts")],
    {
      env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "" },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`זריעת טיוטת המייל נכשלה:\n${result.stdout}\n${result.stderr}`);
  }
  const draftId = /DRAFT_ID=(\S+)/.exec(result.stdout)?.[1];
  const dispatchedId = /DISPATCHED_ID=(\S+)/.exec(result.stdout)?.[1];
  const noSiteId = /NO_SITE_ID=(\S+)/.exec(result.stdout)?.[1];
  if (!draftId || !dispatchedId || !noSiteId) {
    throw new Error(`הזריעה לא הדפיסה מזהים:\n${result.stdout}`);
  }
  return { draftId, dispatchedId, noSiteId };
}
