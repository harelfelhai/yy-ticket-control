import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { deliveryNote } from "@/lib/delivery";
import { he } from "@/lib/he";
import { type Viewer, canEditAssignments } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { composeNotification } from "@/lib/notifier/compose";
import { isEmailConfigured } from "@/lib/notifier/email";
import {
  type WaPendingRecipient,
  waShareUrl,
  whatsAppPath,
} from "@/lib/notifier/wa-share";
import { ensurePortalLink } from "./portal";
import type { TicketDetail } from "./tickets";

export class DeliveryError extends UserFacingError {}

/**
 * מה מסך הפנייה צריך לדעת כדי להציג את שורת השליחה ואת כפתור הוואטסאפ.
 *
 * הכל נקרא בשרת ומגיע ללקוח מוכן: הודעת הוואטסאפ מנוסחת מאותה פונקציה
 * שמנסחת את המייל (`composeNotification`), כך שהקבלן מקבל אותו טקסט בשני
 * הערוצים — ואין גרסה שנייה של הנוסח שמתחזקת בנפרד.
 */

export interface DeliveryView {
  /** טקסט מוכן: מתי נשלח, או למה לא */
  deliveryNote: string;
  /**
   * נתיב **פנימי** שמתעד את הפתיחה ואז מפנה ל-`wa.me`, או null כשאין טלפון.
   *
   * עד 1.0 ישבה כאן כתובת ה-`wa.me` המלאה, ובתוכה קישור הקסם של הקבלן —
   * כלומר סוד גישה שנסע ללקוח ב-payload של כל נמען. עכשיו נוסע מזהה שיוך,
   * והסוד נבנה בשרת ברגע הלחיצה (`/api/wa/[assignmentId]`).
   */
  waUrl: string | null;
  /**
   * הנמען הזה **לא יקבל שום הודעה** אם המנהל לא ישלח לו בוואטסאפ ידנית.
   *
   * יש לו טלפון, אין לו מייל, ואיש עדיין לא פתח עבורו את הוואטסאפ. זהו
   * המצב היחיד שבו הפנייה נראית משוגרת ואיש אינו יודע עליה, והוא מה
   * שהפאנל "נותר לשלוח" מציג.
   */
  waPending: boolean;
  /** האם יש כתובת מייל שאפשר לשלוח אליה שוב (נמען חיצוני או פנימי) */
  canResendEmail: boolean;
  /** מתי השתנה הסטטוס האישי לאחרונה, כטקסט מוכן */
  statusChangedAt: string;
}

/**
 * `includeLink` שולט אם לחשב את קישור הקסם ואת כתובת הוואטסאפ.
 *
 * זו הגנת אבטחה, לא רק אופטימיזציה: הקישור הוא סוד גישה של הקבלן, והוא
 * מגיע ללקוח בתוך ה-payload של הקומפוננטה — גם אם הכפתור מוסתר ויזואלית.
 * צופה שאינו רשאי לערוך נמענים (למשל בעלים שאינו הפותח) אינו אמור לקבל
 * את הקישור כלל, ולכן הקריאה מדלגת עליו לגמרי במקום להסתיר אותו בממשק.
 */
export async function describeDelivery(
  ticket: TicketDetail,
  assignment: TicketDetail["assignments"][number],
  includeLink: boolean,
): Promise<DeliveryView> {
  const professional = assignment.professional;
  const email = professional?.email ?? assignment.user?.email ?? null;
  const phone = professional?.phone ?? null;

  const note = deliveryNote(
    {
      notifiedAt: assignment.notifiedAt,
      waOpenedAt: assignment.waOpenedAt,
      // נמען פנימי: גם בלי מייל הוא נכנס למערכת ורואה את הפנייה בלוח שלו.
      // החיווי נוגע לשליחה החוצה.
      hasEmail: Boolean(email) || assignment.userId !== null,
      hasPhone: Boolean(phone),
      emailConfigured: isEmailConfigured(),
    },
    formatDateTime,
  );

  const reachableByWhatsApp = Boolean(includeLink && professional && phone);

  return {
    deliveryNote: note,
    canResendEmail: Boolean(email),
    statusChangedAt: formatDateTime(assignment.statusChangedAt),
    waUrl: reachableByWhatsApp ? whatsAppPath(assignment.id) : null,
    /*
     * הסטטוס נבדק כאן ולא רק בממשק: נמען שהוסר אינו "נותר לשלוח" אלא
     * מישהו שהוחלט במפורש לא לשלוח לו, והצגתו ברשימת המשימות הייתה
     * מחזירה החלטה שכבר התקבלה.
     */
    waPending:
      reachableByWhatsApp &&
      !email &&
      assignment.userId === null &&
      assignment.notifiedAt === null &&
      assignment.waOpenedAt === null &&
      assignment.status !== "REMOVED",
  };
}



/**
 * מתעד שהמנהל פתח את הוואטסאפ, ומחזיר את כתובת `wa.me` שאליה להפנות.
 *
 * **מה הרישום כן אומר ומה לא.** הוא **לא** אישור מסירה: `wa.me` פותח שיחה
 * עם הטקסט מוכן, והשליחה היא לחיצה נוספת באפליקציה שאין לנו גישה אליה. הוא
 * כן ההבדל בין "המנהל טיפל בזה" ל"אף אחד לא נגע בזה" — ועד לשדה הזה הלוח
 * לא יכול היה להבחין ביניהם, מפני שלקבלן בלי מייל אין `notifiedAt` לעולם.
 *
 * ההרשאה היא `canEditAssignments` ולא `canViewTicket`, ובכוונה: זו אותה
 * קבוצה שמקבלת את הכפתור מלכתחילה (`describeDelivery(..., canEdit)`).
 * צופה שאינו רשאי לערוך נמענים אינו אמור להנפיק קישור גישה של קבלן.
 *
 * **הכתיבה קורית לפני ההחזרה, ולא אחריה.** הקורא הוא route שמפנה החוצה,
 * ובנייד ההפניה מוסרת את השליטה לאפליקציית וואטסאפ — כל מה שהיה נדחה
 * ל"אחרי" עלול פשוט לא לקרות.
 *
 * **נדרס בכל פתיחה** — כמו `notifiedAt` ב"שלח שוב". השאלה שהמנהל שואל היא
 * "מתי לאחרונה נגעו בזה", לא "מתי בפעם הראשונה".
 */
export async function openWhatsApp(viewer: Viewer, assignmentId: string): Promise<string> {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      professional: { select: { id: true, name: true, phone: true } },
      // ‏`closedAt` נדרש ל-`TicketAccessView` ואינו קישוט: הוא חלק מהחוזה
      // של `canEditAssignments`, ושליפה חלקית שמספקת אותו כ-`null` הייתה
      // מסתירה כאן שינוי עתידי בכלל ההרשאה.
      ticket: {
        select: {
          siteId: true,
          createdById: true,
          closedAt: true,
          seq: true,
          description: true,
          building: { select: { name: true } },
          apartment: { select: { number: true } },
          domain: { select: { name: true } },
        },
      },
    },
  });

  if (!assignment) throw new DeliveryError(he.ticket.notFound);
  if (!canEditAssignments(viewer, assignment.ticket)) {
    throw new DeliveryError(he.common.notAllowed);
  }

  const professional = assignment.professional;
  if (!professional?.phone) throw new DeliveryError(he.ticket.notFound);

  // ‏`ensure` ולא `read`: הפתיחה היא פעולה יזומה של המנהל, ולכן זה המקום
  // שבו מותר להנפיק טוקן אם משום מה אין. מסך שרק **נטען** אינו מייצר סודות.
  const link = await ensurePortalLink(professional.id);

  const message = composeNotification({
    event: "ASSIGNED",
    toName: professional.name,
    ticket: {
      seq: assignment.ticket.seq,
      description: assignment.ticket.description,
      buildingName: assignment.ticket.building?.name ?? null,
      apartmentNumber: assignment.ticket.apartment?.number ?? null,
      domainName: assignment.ticket.domain?.name ?? null,
    },
    link,
  });

  const url = waShareUrl(professional.phone, message.body);
  if (!url) throw new DeliveryError(he.ticket.notFound);

  await db.assignment.update({
    where: { id: assignmentId },
    data: { waOpenedAt: new Date() },
  });

  return url;
}

/**
 * מבין השיוכים שנוצרו זה עתה — מי מהם לא יקבל שום הודעה אוטומטית.
 *
 * זהו בדיוק צירוף התנאים שהמערכת אינה יכולה לכסות: **איש מקצוע חיצוני, עם
 * טלפון, בלי מייל.** נמען פנימי נכנס עם סיסמה ורואה את הפנייה בלוח שלו; מי
 * שיש לו מייל מקבל הודעה מה-worker; ומי שאין לו לא טלפון ולא מייל נחסם כבר
 * ביצירה (`assertContactable`).
 *
 * ‏`notifiedAt`/`waOpenedAt` נבדקים אף שהשיוך נוצר לפני רגע: הפונקציה
 * נקראת גם על שיוך **שהוחזר** אחרי הסרה, ושם ההיסטוריה קיימת.
 */
export async function pendingWhatsAppRecipients(
  assignmentIds: string[],
): Promise<WaPendingRecipient[]> {
  if (assignmentIds.length === 0) return [];

  const rows = await db.assignment.findMany({
    where: {
      id: { in: assignmentIds },
      status: { not: "REMOVED" },
      notifiedAt: null,
      waOpenedAt: null,
      professional: { phone: { not: null }, email: null },
    },
    select: { id: true, professional: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({ assignmentId: row.id, name: row.professional?.name ?? "" }));
}

/**
 * מסמן מראש את הנמען שעבורו הלשונית **כבר נפתחה** בדפדפן, ומחזיר את מזההו.
 *
 * **למה הסימון כאן ולא רק ב-`openWhatsApp`.** הלשונית והמסך נטענים במקביל:
 * הלשונית פונה ל-`/api/wa/…` בזמן שהדפדפן מרנדר את מסך הפנייה. מי שמנצח
 * במירוץ הזה קובע מה המנהל רואה — ובריצה שנמדדה ניצח המסך, כך שהנמען שהוואטסאפ
 * שלו נפתח לנגד עיניו הופיע ברשימת "נותר לשלוח". מנהל שיפעל לפיה ישלח פעמיים.
 *
 * הסימון כאן קורה **באותה פעולה** שהמסך נבנה ממנה, ולכן אין מירוץ. ‏`openWhatsApp`
 * ידרוס אותו כעבור רגע באותו ערך בקירוב — הוא נשאר מקור האמת ללחיצה ידנית.
 *
 * ‏`hasOpenTab` מגיע מהלקוח והוא **הכרחי**: `window.open` נחסם בחלק
 * מהדפדפנים, ומי שחסום לא ראה שום לשונית. סימון במקרה הזה היה מסתיר את
 * המשימה היחידה שנשארה — כלומר הופך את התיקון לגרסה גרועה יותר של הבאג.
 */
export async function claimWhatsAppAutoOpen(
  assignmentIds: string[],
  hasOpenTab: boolean,
): Promise<string | null> {
  if (!hasOpenTab) return null;

  const [first] = await pendingWhatsAppRecipients(assignmentIds);
  if (!first) return null;

  await db.assignment.update({
    where: { id: first.assignmentId },
    data: { waOpenedAt: new Date() },
  });

  return first.assignmentId;
}
