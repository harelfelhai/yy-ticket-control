import type { Room } from "@/generated/prisma/enums";

/**
 * רשימת החדרים הקבועה (אפיון §3.3) — מקור אמת אחד.
 *
 * ‏tuple קבוע (`as const`) ולא מערך רגיל: כך אפשר להעביר אותו גם ל-`z.enum`
 * (שדורש tuple של מחרוזות ליטרליות) וגם למיפוי בקומפוננטות, בלי לשכפל את
 * הרשימה בכל מקום שצריך אותה. הסדר הוא סדר התצוגה בבוררים.
 *
 * ה-`satisfies` מוודא שכל ערך הוא Room תקין — הוספת חדר ל-Prisma בלי לעדכן
 * כאן (או ההפך) מפילה את הקומפילציה.
 */
export const ROOMS = [
  "SALON",
  "KITCHEN",
  "BEDROOM",
  "BATHROOM",
  "WC",
  "BALCONY",
  "MAMAD",
  "STAIRWELL",
  "PARKING",
  "LOBBY",
  "COMMON",
] as const satisfies readonly Room[];
