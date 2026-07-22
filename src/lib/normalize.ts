/**
 * נרמול קלט חופשי לפני שמירה או השוואה.
 *
 * הקובץ הזה קיים כי כמעט כל הרשימות במערכת **נלמדות תוך כדי עבודה** ולא
 * מוגדרות מראש: בניין, דירה, תחום ואיש מקצוע נוצרים ברגע שמישהו מקליד
 * ערך חדש. בלי נרמול, "07" ו-"7" הן שתי דירות, "050-123-4567" ו-
 * "0501234567" הם שני קבלנים, ומנהל שמחפש פנייה לא מוצא אותה.
 *
 * הפונקציות טהורות ואינן נוגעות ב-DB, כדי שהן ייבדקו ישירות ויוכלו לרוץ
 * גם בדפדפן (למשל להצגת תצוגה מקדימה של הערך שיישמר).
 */

/** מסיר רווחים מיותרים ומאחד רצפי רווחים לאחד */
export function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * מנרמל טקסט חופשי (תיאור פנייה, הודעה) **תוך שמירת ירידות שורה**.
 *
 * ‏`normalizeName` אינו מתאים כאן: הוא מכווץ כל רצף רווחים לרווח אחד,
 * כולל ירידות שורה, ולכן תיאור שנכתב בשלוש שורות היה מתמוטט לשורה אחת
 * ארוכה. בשטח מקלידים תיאור רב-שורתי, והמבנה הוא חלק מהמידע.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    // רווחים וטאבים בתוך שורה מתכווצים, ירידות שורה נשמרות
    .replace(/[^\S\n]+/g, " ")
    // שורה ריקה אחת לכל היותר בין פסקאות
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * מאחד מספרי טלפון ישראליים לצורה מקומית אחת: `0501234567`.
 *
 * המניע מעשי: אותו קבלן נשמר פעם כ-"054-1234567" ופעם כ-"+972 54 1234567",
 * ואז הוא מופיע פעמיים ברשימה ומקבל שני קישורי גישה שונים. המספר גם משמש
 * לזיהוי בהתחברות ולבניית כתובת wa.me, ושתי אלה דורשות התאמה מדויקת.
 *
 * מספר שאינו ישראלי נשמר עם הקידומת הבינלאומית, בלי מפרידים.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const isInternational = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00")) digits = digits.slice(2);

  // ‏972 היא קידומת ישראל. תנאי האורך מונע המרה שגויה של מספר מקומי
  // שבמקרה מתחיל ב-972.
  if (digits.startsWith("972") && digits.length >= 11) {
    return `0${digits.slice(3)}`;
  }

  return isInternational ? `+${digits}` : digits;
}

/**
 * מאחד מספרי דירה: מסיר רווחים ואפסים מובילים.
 * ‏"07" ו-"7" הן אותה דירה; "12א" נשאר כמות שהוא, כי אות היא חלק מהמספר.
 */
export function normalizeApartmentNumber(input: string): string {
  return normalizeName(input).replace(/^0+(?=\d)/, "");
}

/** בדיקה רופפת בכוונה: תפקידה למנוע שגיאת הקלדה, לא לאמת שהתיבה קיימת */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
