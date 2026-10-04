import { normalizePhone } from "@/lib/normalize";

/**
 * הטלפון שוואטסאפ מוסרת (`wa_id`, `from`) בצורה שבה הטלפון שמור בכרטיס
 * המשתמש — כדי שהזיהוי (§2.7 שלב 2) יהיה השוואה פשוטה מול `User.phone`.
 *
 * וואטסאפ מוסרת את המספר בלי `+` ("972501234567"). כאן מוסיפים אותו ומעבירים
 * דרך `normalizePhone`, **המקור היחיד** לצורה שבה טלפון נשמר: מספר ישראלי
 * חוזר כ-`0501234567`, ומספר זר כ-`+15551234567` — בדיוק כמו שנשמר בהקמת משתמש.
 * מחזיר null כשאין מספר (משתמש שוואטסאפ הסתירה את הטלפון שלו, §7 שורה 107).
 */
export function phoneFromWaId(waId: string | null | undefined): string | null {
  if (!waId) return null;
  const digits = waId.replace(/\D/g, "");
  if (!digits) return null;
  return normalizePhone(`+${digits}`) || null;
}
