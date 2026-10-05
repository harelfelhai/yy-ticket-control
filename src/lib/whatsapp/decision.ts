import type { WaOutcome } from "@/generated/prisma/enums";
import { hasIntakeKeyword } from "@/lib/intake/keyword";
import type { WaInboundMessage } from "./webhook";

/**
 * ההכרעה שאפשר לקבל כבר ברישום הודעת וואטסאפ, בלי לקבץ ובלי לקרוא את
 * התוכן (אפיון §2.7, §5.ה5). **טהורה**: כל הקלט בפרמטרים, וכל שורה בכלל היא
 * מקרה בבדיקת טבלה.
 */

/** מי שלח — לפי הטלפון, ואז לפי המזהה שוואטסאפ מצמידה לו (BSUID) */
export type SenderMatch =
  | { kind: "user"; userId: string }
  /** יש טלפון, אבל לא של משתמש מורשה ופעיל */
  | { kind: "unauthorized" }
  /** אין טלפון ואין מזהה מוכר — וואטסאפ הסתירה את הטלפון (§7 שורה 107) */
  | { kind: "unidentified" };

/** הסוגים שנקלטים (§2.7 שלב 3). כל השאר — `IGNORED_UNSUPPORTED` (§7 שורה 96). */
export const INTAKE_TYPES: ReadonlySet<string> = new Set(["text", "image", "audio", "video", "document"]);

/**
 * ההכרעה, או null כשההודעה ממתינה לקיבוץ לדיווח.
 *
 * הסדר: קליטה כבויה (או מספר שאינו מחובר) גוברת על הכול — אין שום עיבוד;
 * לפני החיבור — היסטוריה, לא קלט; שולח שאינו מורשה — **לפני** הסוג, כדי
 * שעל הודעה של זר לא יידע יותר מהנדרש; ורק למשתמש מורשה נשאל מה הסוג.
 *
 * מי שוואטסאפ הסתירה את הטלפון שלו, ושלח "תקלה", נספר בנפרד
 * (`IGNORED_UNIDENTIFIED`) — זו הספירה שמסך 17 מציג (§7 שורה 107). המילה
 * נבדקת בטקסט ובכיתוב בלבד: הקלטה של מי שאינו מזוהה אינה מתומללת (שורה 95).
 */
export function cheapDecision(input: {
  enabled: boolean;
  number: { status: string; activatedAt: Date };
  message: Pick<WaInboundMessage, "sentAt" | "type" | "text">;
  sender: SenderMatch;
}): WaOutcome | null {
  const { enabled, number, message, sender } = input;
  if (!enabled || number.status !== "CONNECTED") return "IGNORED_DISABLED";
  if (message.sentAt.getTime() < number.activatedAt.getTime()) return "IGNORED_BEFORE_ACTIVATION";
  if (sender.kind === "unidentified") {
    return message.text && hasIntakeKeyword(message.text) ? "IGNORED_UNIDENTIFIED" : "IGNORED_UNAUTHORIZED";
  }
  if (sender.kind === "unauthorized") return "IGNORED_UNAUTHORIZED";
  if (!INTAKE_TYPES.has(message.type)) return "IGNORED_UNSUPPORTED";
  return null;
}
