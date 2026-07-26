import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  decryptToken,
  encryptToken,
  generateToken,
  hashToken,
  portalUrl,
} from "@/lib/tokens";

/**
 * גישת הנמען החיצוני לפורטל.
 *
 * הכלל היחיד שקובע כאן: **הטוקן מזהה מי אתה, השיוכים קובעים מה אתה רואה.**
 * הטוקן לעולם אינו נושא הרשאות בעצמו. לכן קבלן שהוסר מפנייה מאבד אליה
 * גישה מיידית, גם אם הקישור שבידיו תקף לחלוטין — וזו הסיבה שאין צורך
 * בתפוגה לקישור.
 */

/**
 * מחזיר את קישור הגישה של איש המקצוע, ומנפיק חדש רק אם אין לו אחד.
 *
 * **זו פעולת ברירת המחדל**, וכל שליחה יוצאת עוברת דרכה. הכוונה היא שקבלן
 * יחזיק קישור אחד יציב לאורך זמן: הוא שומר אותו בוואטסאפ, נכנס ממנו שוב
 * ושוב, ומקבל את אותה כתובת בכל הודעה חדשה. קישור שמתחלף בכל שיגור היה
 * הופך כל הודעה ישנה בשיחה למבוי סתום.
 *
 * הנפקה חדשה קורית רק בשני מקרים: אין טוקן פעיל, או שיש כזה שאי אפשר
 * לפענח (SESSION_SECRET הוחלף). בשניהם אין מה לשלוח מלבד קישור חדש.
 */
export async function ensurePortalLink(professionalId: string): Promise<string> {
  return (await readPortalLink(professionalId)) ?? rotatePortalLink(professionalId);
}

/** מספיק לו `accessToken` — כך אפשר להעביר גם את לקוח הטרנזאקציה */
type TokenClient = Pick<typeof db, "accessToken">;

/**
 * מוודא שלאיש המקצוע יש קישור גישה פעיל, בלי להחזיר אותו.
 *
 * נקרא **בתוך הטרנזאקציה של השיוך**, ובכוונה: שיוך קבלן לפנייה *הוא* מתן
 * הגישה, ואין מצב ביניים שבו הוא משויך אך אין לו דרך להיכנס. התוצאה
 * המעשית היא שמסך הפנייה יכול לקרוא את הקישור בלי לכתוב דבר בזמן טעינה,
 * וכפתור הוואטסאפ מוכן כבר ברענון הראשון.
 *
 * אינו מבטל דבר: אם יש טוקן פעיל, הוא נשאר — זו כל הנקודה של קישור יציב.
 */
export async function ensureAccessToken(
  client: TokenClient,
  professionalId: string,
): Promise<void> {
  const active = await client.accessToken.findFirst({
    where: { professionalId, revokedAt: null },
    select: { id: true },
  });
  if (active) return;

  const token = generateToken();
  await client.accessToken.create({
    data: {
      professionalId,
      tokenHash: hashToken(token),
      tokenCipher: encryptToken(token, env.sessionSecret()),
    },
  });
}

/**
 * מחזיר את הקישור הקיים בלי ליצור דבר, או null אם אין.
 *
 * קיים כדי שמסך הפנייה יוכל להציג את כפתור הוואטסאפ בלי לכתוב לבסיס
 * הנתונים בזמן טעינת עמוד. טעינה שמייצרת רשומות היא הפתעה: היא רצה גם
 * בטעינה מוקדמת של הדפדפן ובכל רענון, ואז "מתי נוצר הקישור" מפסיק להיות
 * שאלה שיש לה תשובה.
 */
export async function readPortalLink(professionalId: string): Promise<string | null> {
  const active = await db.accessToken.findFirst({
    where: { professionalId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!active?.tokenCipher) return null;

  const token = decryptToken(active.tokenCipher, env.sessionSecret());
  return token ? portalUrl(env.appBaseUrl(), token) : null;
}

/**
 * מנפיק קישור חדש ומבטל את הקודם — פעולה מפורשת של מנהל.
 *
 * זהו המענה לקישור שדלף או שהגיע לאדם הלא נכון, ולכן ביטול הישן הוא
 * מהות הפעולה ולא תופעת לוואי. בממשק היא מנוסחת כ"צור קישור חדש" ומופרדת
 * מ"שלח שוב את הקישור", כי מנהל שרצה רק לשלוח שוב ובמקום זה הרג לקבלן את
 * הקישור השמור הוא בדיוק התקלה שהפרדת הפעולות מונעת.
 */
export async function rotatePortalLink(professionalId: string): Promise<string> {
  const token = generateToken();

  await db.$transaction(async (tx) => {
    await tx.accessToken.updateMany({
      where: { professionalId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.accessToken.create({
      data: {
        professionalId,
        tokenHash: hashToken(token),
        tokenCipher: encryptToken(token, env.sessionSecret()),
      },
    });
  });

  return portalUrl(env.appBaseUrl(), token);
}

/**
 * מבטל את גישת איש המקצוע אם לא נותר לו דבר שדורש גישה — לא שיוך פעיל
 * ולא תגית שנפתחה לו.
 *
 * נקרא בהסרת נמען (M2) ובביטול גישת תגית (M4). הרציונל: קבלן בלי שיוכים
 * ובלי צ׳אט פתוח כבר אינו עובד איתנו, ואין סיבה שיחזיק בידיו סוד חי.
 *
 * **שני התנאים הכרחיים.** קבלן שנפתחה לו תגית אך אינו משויך לאף פנייה
 * צריך קישור חי כדי להגיע לצ׳אט — ספירת שיוכים לבדה הייתה הורגת לו אותו.
 * וההפך: קבלן ששויך לפניות אך התגית שלו בוטלה שומר על גישתו לפניות.
 *
 * הספירה כוללת גם פניות סגורות בכוונה: הארכיון שלו נשאר נגיש, וקבלן שסיים
 * עבודה אתמול אינו אמור לגלות מחר שהקישור מת.
 */
export async function revokeAccessIfOrphaned(professionalId: string): Promise<boolean> {
  const [assignments, tagGrants] = await Promise.all([
    db.assignment.count({ where: { professionalId, status: { not: "REMOVED" } } }),
    db.tagAccess.count({ where: { professionalId } }),
  ]);
  if (assignments > 0 || tagGrants > 0) return false;

  const { count } = await db.accessToken.updateMany({
    where: { professionalId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}

/**
 * הגבלת קצב לפעולות כתיבה של קבלן בפורטל — הגנה מפני הצפה (spam) של הודעות
 * או ריצוד סטטוסים.
 *
 * מפתח לפי **מזהה איש המקצוע** (הזהות שהטוקן קובע), לא לפי IP: חסין לזיוף
 * ובלתי-תלוי בפריסה. חל רק על פעולות כתיבה — טעינת דף היא קריאה זולה ולא-
 * abusive, וממילא הטוקן בן 128 הביט בלתי-בר-ניחוש, כך שאין מה למנוע בניחוש.
 */
export const PORTAL_ACTION_LIMIT = 30;
export const PORTAL_ACTION_WINDOW_MS = 60_000;

export async function allowPortalAction(
  professionalId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { allowed } = await consumeRateLimit(
    `portal:${professionalId}`,
    PORTAL_ACTION_LIMIT,
    PORTAL_ACTION_WINDOW_MS,
    now,
  );
  return allowed;
}

export interface PortalIdentity {
  professionalId: string;
  name: string;
  tokenId: string;
}

/**
 * מאמת טוקן ומחזיר את זהות איש המקצוע, או null.
 * מעדכן `lastUsedAt` כדי שיהיה אפשר לזהות קישורים נטושים בעתיד.
 */
export async function resolveToken(token: string): Promise<PortalIdentity | null> {
  if (!token) return null;

  const record = await db.accessToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { professional: { select: { id: true, name: true } } },
  });

  if (!record || record.revokedAt !== null) return null;

  await db.accessToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    professionalId: record.professional.id,
    name: record.professional.name,
    tokenId: record.id,
  };
}

/**
 * הלוח האישי של הקבלן: הפניות הפעילות שלו והארכיון שלו.
 *
 * מכל האתרים ולא רק מאחד — לקבלן משנה אין "אתר משלו", והוא עובד בכמה
 * פרויקטים במקביל (אפיון §5.ז).
 */
export async function getPortalBoard(professionalId: string) {
  const assignments = await db.assignment.findMany({
    // סינון טיוטות הוא הגנה בעומק: לטיוטה אין שיוכים בפועל, אבל אם אי-פעם
    // ייווצר כזה, טיוטה שלא נשלחה לאיש לא תופיע בלוח של הקבלן.
    where: { professionalId, status: { not: "REMOVED" }, ticket: { isDraft: false } },
    orderBy: { ticket: { lastActivityAt: "desc" } },
    include: {
      ticket: {
        include: {
          building: { select: { name: true } },
          apartment: { select: { number: true } },
          domain: { select: { name: true } },
        },
      },
    },
  });

  return {
    active: assignments.filter((a) => a.ticket.closedAt === null),
    archived: assignments.filter((a) => a.ticket.closedAt !== null),
  };
}

/**
 * פנייה בודדת בפורטל, אם ורק אם יש לקבלן שיוך פעיל אליה.
 *
 * מחזיר גם את השרשור המלא: נמען שצורף לפנייה קיימת מקבל גישה לכל
 * ההיסטוריה שקדמה לו, כדי שיבין את ההקשר (מסמך המקור §4.2).
 */
export async function getPortalTicket(professionalId: string, ticketId: string) {
  const assignment = await db.assignment.findFirst({
    where: { professionalId, ticketId, status: { not: "REMOVED" }, ticket: { isDraft: false } },
  });
  if (!assignment) return null;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      building: { select: { name: true } },
      apartment: { select: { number: true } },
      domain: { select: { name: true } },
      // שם הפותח — כדי שההודעות לקבלן יאמרו למי הפנייה הועברה (אפיון מסך 8).
      createdBy: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          authorUser: { select: { name: true } },
          authorProfessional: { select: { name: true } },
          media: { where: { uploaded: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!ticket) return null;

  return { ticket, assignment };
}

/**
 * מסמן את הפנייה כנצפית בפתיחה ראשונה.
 * רק מ-SENT: קבלן שכבר סימן "טופל" ופותח שוב את הקישור לא אמור לאבד את
 * הדיווח שלו.
 */
export async function markViewed(assignmentId: string): Promise<void> {
  await db.assignment.updateMany({
    where: { id: assignmentId, status: "SENT" },
    data: { status: "VIEWED", statusChangedAt: new Date(), viewedAt: new Date() },
  });
}
