import type { MediaView } from "./media-view";

/**
 * הודעת שרשור בצורת תצוגה — מקור אמת אחד לשלושת המקומות שמרנדרים שיחה.
 *
 * **למה טיפוס מפורש ולא נגזרת של Prisma.** שלושת ה-payloads שונים זה מזה
 * ואינם תואמים: `getTicketDetail` בוחר `authorUser: {id, name}`, ואילו
 * `getPortalTicket` ו-`loadTagMessages` בוחרים `{name}` בלבד. טיפוס משותף
 * שנגזר מאחד מהם היה כופה על השניים האחרים לשלוף שדות שאינם דרושים להם, או
 * גרוע מזה — היה נשבר בשקט ברגע שאחת מהשאילתות תשתנה.
 *
 * הטיפוס הזה הוא **מה שהתצוגה צריכה**, ולא מה שה-DB במקרה מחזיק. אותה
 * הכרעה בדיוק כמו `MediaView`, ומאותה סיבה.
 */
export interface ThreadMessageView {
  id: string;
  /** שם הכותב כפי שיוצג. ריק רק באירוע מערכת, שאינו עובר כאן */
  authorName: string;
  /** האם הצופה הנוכחי הוא הכותב — קובע את צד היישור */
  own: boolean;
  text: string | null;
  media: MediaView[];
  createdAt: Date;
}

/** מזהה הצופה, לקביעת `own`. נמען חיצוני ומשתמש פנימי אינם חולקים מרחב מזהים. */
export interface ThreadViewer {
  userId?: string | null;
  professionalId?: string | null;
}

/** הרשומה כפי שהיא נשמרת, בשדות שהתצוגה זקוקה להם בלבד */
export interface ThreadMessageRecord {
  id: string;
  text: string | null;
  createdAt: Date;
  authorUser: { id?: string; name: string } | null;
  authorProfessional: { id?: string; name: string } | null;
}

/**
 * ממיר הודעה שמורה לצורת התצוגה.
 *
 * ‏`own` מחושב כאן ולא ברכיב: הרכיב הוא רכיב שרת חסר הקשר, והצופה שונה בכל
 * אחד משלושת אתרי הקריאה. כשמזהה הכותב אינו נשלף כלל (הפורטל וצ׳אט התגית
 * בוחרים `{name}` בלבד), `own` הוא `false` — וזה נכון: בפורטל כל ההודעות
 * מוצגות אחידות ממילא, ואין מה להשוות מולו.
 */
export function toThreadMessageView(
  message: ThreadMessageRecord,
  media: MediaView[],
  viewer: ThreadViewer = {},
): ThreadMessageView {
  const authorUserId = message.authorUser?.id;
  const authorProfessionalId = message.authorProfessional?.id;

  const own = Boolean(
    (authorUserId && viewer.userId && authorUserId === viewer.userId) ||
      (authorProfessionalId &&
        viewer.professionalId &&
        authorProfessionalId === viewer.professionalId),
  );

  return {
    id: message.id,
    authorName: message.authorUser?.name ?? message.authorProfessional?.name ?? "",
    own,
    text: message.text,
    media,
    createdAt: message.createdAt,
  };
}
