/**
 * חישוב זמן הריצה של הג'וב היומי — לוגיקה טהורה, בלי DB.
 *
 * מופרד מ-`handlers/escalation.ts` (שנוגע ב-DB) בכוונה: חישוב "06:00 הבא
 * בשעון ישראל" הוא בדיוק המקום שבו טמון באג עונת הקיץ, והוא חייב להיות
 * ניתן לבדיקת יחידה בלי חיבור לבסיס נתונים.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = "Asia/Jerusalem";

/** השעה (שעון ישראל) שבה רצה ההסלמה היומית. */
export const ESCALATION_HOUR = 6;

/**
 * ה-06:00 (שעון ישראל) הבא אחרי `now`, כרגע UTC.
 *
 * הזמן נשמר ב-UTC (כל המערכת כך), אבל הג'וב חייב לרוץ ב-06:00 מקומי —
 * שעה שבה מנהל פותח את הלוח בבוקר ורואה מה הוסלם בלילה. עונת הקיץ מזיזה
 * את ישראל בין UTC+2 ל-UTC+3, ולכן ההיסט מחושב מתוך `Intl` ליום היעד
 * ולא מקובע. 06:00 רחוק ממעבר שעון הקיץ (02:00), ולכן ההיסט יציב סביבו.
 */
export function nextEscalationRun(now: Date): Date {
  const today = israelParts(now);
  let target = israelWallClockToUtc(today.year, today.month, today.day, ESCALATION_HOUR);

  if (target.getTime() <= now.getTime()) {
    const tomorrow = israelParts(new Date(now.getTime() + DAY_MS));
    target = israelWallClockToUtc(tomorrow.year, tomorrow.month, tomorrow.day, ESCALATION_HOUR);
  }

  return target;
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
