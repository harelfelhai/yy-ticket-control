import { db } from "@/lib/db";

/**
 * מגביל קצב פשוט על גבי טבלה ב-Postgres, בלי Redis.
 *
 * **מפתח לוגי, לא IP.** כל מגביל מזוהה במפתח שהוא זהות במערכת ("login:<מזהה>",
 * "portal:<מזהה איש מקצוע>"), ולא בכתובת IP. ‏IP מאחורי proxy מגיע מכותרת
 * `x-forwarded-for` שהיא ניתנת-לזיוף על ידי הלקוח וגם תלויה בתצורת הפריסה
 * (כמה קפיצות proxy, איזו כותרת נאמנת) — תלות שהופכת את ההגבלה לשברירית.
 * מפתח מבוסס-זהות חסין לזיוף ובלתי-תלוי בפריסה.
 *
 * **חלון קבוע** ולא sliding-log: פשוט, זול (שורה אחת למפתח), ומדויק דיו
 * לצורך — הרעה בגבול החלון אינה משמעותית מול brute-force. הספירה אטומית
 * (‏INSERT ... ON CONFLICT יחיד), ולכן בקשות מקבילות אינן דורסות זו את זו.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** שניות עד שהחלון נפתח, כשההחלטה היא חסימה; 0 כשמותר. */
  retryAfterSeconds: number;
}

/**
 * רושם אירוע אחד למפתח ומחזיר אם הוא בגבול המותר.
 *
 * ‏INSERT ... ON CONFLICT יחיד ואטומי: אם החלון פג, המונה מתאפס ל-1 והחלון
 * נפתח מחדש; אחרת המונה עולה ב-1. שתי בקשות שמגיעות יחד מטופלות על ידי נעילת
 * השורה של Postgres, בלי מרוץ קריאה-אז-כתיבה. מותר כל עוד המונה המתקבל
 * אינו עולה על `limit` — כלומר בדיוק `limit` אירועים בחלון, והבא נחסם.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const expiresAt = new Date(now.getTime() + windowMs);

  const rows = await db.$queryRaw<{ count: number; expiresAt: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."expiresAt" <= ${now}
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= ${now}
                         THEN ${expiresAt} ELSE "RateLimit"."expiresAt" END
    RETURNING "count", "expiresAt"
  `;

  const row = rows[0];
  const allowed = row.count <= limit;
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : secondsUntil(row.expiresAt, now),
  };
}

/**
 * בודק אם המפתח כבר חסום, **בלי לרשום אירוע**.
 *
 * ‏login משתמש בזה כדי לבדוק חסימה *לפני* אימות הסיסמה: מזהה שכבר נחסם לא
 * אמור לשלם על גיבוב argon2 יקר בכל ניסיון. את הכשל עצמו סופר `consumeRateLimit`
 * רק כשהאימות נכשל.
 */
export async function peekRateLimit(
  key: string,
  limit: number,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const row = await db.rateLimit.findUnique({ where: { key } });
  const limited = row !== null && row.expiresAt > now && row.count >= limit;
  return {
    allowed: !limited,
    retryAfterSeconds: limited ? secondsUntil(row.expiresAt, now) : 0,
  };
}

/** מאפס מפתח. ‏login קורא לזה בהצלחה, כדי שמונה הכשלים לא ייוותר תלוי. */
export async function clearRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/**
 * מוחק חלונות שפג תוקפם. נקרא מהג'וב היומי כדי שהטבלה לא תתפח: כל מזהה
 * חדש שנכשל בהתחברות משאיר שורה, ובלי ניקוי הן מצטברות ללא גבול.
 */
export async function cleanupRateLimits(now: Date = new Date()): Promise<number> {
  const { count } = await db.rateLimit.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}

/** לפחות שנייה אחת — כדי שהודעה למשתמש לא תאמר "נסה שוב בעוד 0". */
function secondsUntil(when: Date, now: Date): number {
  return Math.max(1, Math.ceil((when.getTime() - now.getTime()) / 1000));
}
