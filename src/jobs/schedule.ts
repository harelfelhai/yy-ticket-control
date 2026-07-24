/**
 * חישוב זמן הריצה של הג'ובים היומיים — לוגיקה טהורה, בלי DB.
 *
 * מופרד מה-handlers (שנוגעים ב-DB) בכוונה: חישוב "השעה ה-X הבאה בשעון
 * ישראל" הוא בדיוק המקום שבו טמון באג עונת הקיץ, והוא חייב להיות ניתן
 * לבדיקת יחידה בלי חיבור לבסיס נתונים.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = "Asia/Jerusalem";

/** השעה (שעון ישראל) שבה רצה ההסלמה היומית — בוקר, כשמנהל פותח את הלוח. */
export const ESCALATION_HOUR = 6;

/** השעה (שעון ישראל) שבה רץ הגיבוי הלילי — שעה שקטה, הרחק מעומס היום. */
export const BACKUP_HOUR = 3;

/**
 * ה-`hour`:00 (שעון ישראל) הבא אחרי `now`, כרגע UTC.
 *
 * הזמן נשמר ב-UTC (כל המערכת כך), אבל הג'ובים חייבים לרוץ בשעון מקומי.
 * עונת הקיץ מזיזה את ישראל בין UTC+2 ל-UTC+3, ולכן ההיסט מחושב מתוך `Intl`
 * ליום היעד ולא מקובע. השעות שבשימוש (03:00, 06:00) רחוקות ממעבר שעון הקיץ
 * (02:00), ולכן ההיסט יציב סביבן.
 */
export function nextIsraelHour(now: Date, hour: number): Date {
  const today = israelParts(now);
  let target = israelWallClockToUtc(today.year, today.month, today.day, hour);

  if (target.getTime() <= now.getTime()) {
    const tomorrow = israelParts(new Date(now.getTime() + DAY_MS));
    target = israelWallClockToUtc(tomorrow.year, tomorrow.month, tomorrow.day, hour);
  }

  return target;
}

/** ה-06:00 הבא בשעון ישראל — מתי לסמן פניות ללא תנועה. */
export function nextEscalationRun(now: Date): Date {
  return nextIsraelHour(now, ESCALATION_HOUR);
}

/** ה-03:00 הבא בשעון ישראל — מתי לגבות את בסיס הנתונים. */
export function nextBackupRun(now: Date): Date {
  return nextIsraelHour(now, BACKUP_HOUR);
}

interface IsraelParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** רכיבי שעון הקיר של ישראל עבור רגע נתון */
function israelParts(instant: Date): IsraelParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // ‏Intl מחזיר לעיתים "24" לחצות; מנרמלים ל-0.
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
  };
}

/** ההיסט של ישראל מ-UTC (בדקות) ברגע נתון */
function israelOffsetMinutes(instant: Date): number {
  const p = israelParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** ממיר שעון-קיר ישראלי (שנה/חודש/יום/שעה) לרגע UTC */
function israelWallClockToUtc(year: number, month: number, day: number, hour: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, 0);
  const offset = israelOffsetMinutes(new Date(naive));
  return new Date(naive - offset * 60000);
}
