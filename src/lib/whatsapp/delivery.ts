import type { MessageState } from "@/generated/prisma/enums";

/**
 * מצב המסירה של הודעה יוצאת בוואטסאפ, כפי שהוא מוצג — במסך 17 (הודעת הבדיקה) ובשיחת
 * הוואטסאפ במסך 7 (הודעות האישור). **חישוב אחד, ונוסח לכל מסך:** האפיון אומר "לא
 * נמסרה" במסך 17 ו"לא נשלחה" במסך 7, ושני הנוסחים ב-`he`.
 *
 * הסטטוסים מגיעים מ-Meta ב-webhook ונכתבים על השורה (`wa-webhook.ts`): `deliveredAt`,
 * `readAt`, ו-`FAILED` עם קוד. "נקראה" גובר על "נמסרה" — Meta שולחת את שניהם, ולא
 * בהכרח לפי הסדר.
 */
export type WaDelivery = "sent" | "delivered" | "read" | "failed";

/**
 * הודעה שיצאה לדרכה, או שלא תצא. `PENDING` אינה מגיעה לכאן: היא "עדיין לא", ושני
 * הקוראים מסננים אותה. `SKIPPED` היא "לא נשלחה" — מי שמבחין בין דילוג צפוי לכשל
 * (טיוטה ששוגרה לפני שהאישור יצא, §7 שורה 77) עושה זאת לפי הסיבה, לא כאן.
 */
export function waDelivery(row: { state: MessageState; deliveredAt: Date | null; readAt: Date | null }): WaDelivery {
  if (row.state === "FAILED" || row.state === "SKIPPED") return "failed";
  if (row.readAt) return "read";
  if (row.deliveredAt) return "delivered";
  return "sent";
}
