import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { he } from "@/lib/he";

/**
 * מחיקה חסומה־ומוסברת — מנגנון אחד לכל רשומות העזר (אפיון §7 שורה 24).
 *
 * **למה ספירה מפורשת בקוד ולא הישענות על ה-DB.** הסכימה מגדירה `Restrict`
 * כברירת מחדל, ולכן ברוב המקרים מחיקה עם הפניות הייתה נכשלת ממילא — אבל לא
 * בכולם, ודווקא החריגים הם ההרסניים:
 *
 * - ל-`Tag` יש `TicketTag`, `TagAccess` **ו-`Message`** ב-Cascade. מחיקת תגית
 *   דרך ה-DB הייתה עוברת בשקט ומשמידה צ׳אט קבוצתי שלם.
 * - ל-`Professional` יש `AccessToken` ו-`TagAccess` ב-Cascade.
 *
 * כלומר אילוצי ה-DB אינם ספציפיקציית המחיקה של המוצר — הם מקרה פרטי שלה.
 * הספירה כאן היא הספציפיקציה, וה-`Restrict` הוא רשת ביטחון מתחתיה.
 *
 * **למה כשל ולא מחיקה בשרשרת.** המחיקה נועדה לנקות טעות הקלדה ("חשמלל"),
 * לא להעלים היסטוריה. רשומה שיש אליה הפניות היא רשומה שנעשה בה שימוש אמיתי,
 * ולכן התשובה הנכונה היא הסבר ולא הרס. ההסבר נוקב **במה** חוסם ובכמה —
 * "לא ניתן למחוק" לבדו הוא בדיוק הכפתור הדומם שדווח מהשטח.
 */

export class DeletionBlockedError extends UserFacingError {}

export type DeletableEntity =
  | "site"
  | "building"
  | "apartment"
  | "domain"
  | "professional"
  | "tag"
  | "user";

/**
 * סוג ההפניה החוסמת. המפתח הוא נתון; הניסוח בעברית נגזר ממנו ב-`he.ts`,
 * כדי שבדיקות יוכלו לטעון על העובדה ולא על המחרוזת.
 */
export type BlockingKind =
  | "tickets"
  | "buildings"
  | "apartments"
  | "users"
  | "assignments"
  | "messages"
  | "taggedTickets"
  | "tagMessages"
  | "createdTags"
  | "uploadedMedia";

export interface BlockingReference {
  kind: BlockingKind;
  count: number;
}

type Counter = (id: string) => Promise<BlockingReference[]>;

async function count(kind: BlockingKind, promise: Promise<number>): Promise<BlockingReference> {
  return { kind, count: await promise };
}

const COUNTERS: Record<DeletableEntity, Counter> = {
  site: (id) =>
    Promise.all([
      count("tickets", db.ticket.count({ where: { siteId: id } })),
      count("buildings", db.building.count({ where: { siteId: id } })),
      // גם משתמש מושבת חוסם: השיוך שלו לאתר עדיין קיים, ומחיקת האתר
      // הייתה משאירה מנהל עבודה בלי האתר שהוא מוגדר עליו.
      count("users", db.user.count({ where: { siteId: id } })),
    ]),

  building: (id) =>
    Promise.all([
      count("tickets", db.ticket.count({ where: { buildingId: id } })),
      count("apartments", db.apartment.count({ where: { buildingId: id } })),
    ]),

  // ⚠️ `Apartment.residentName` הוא הבית היחיד של שם הדייר (אפיון §3.2 שדה 11).
  // דירה בלי פניות נמחקת, ואיתה גם השם — זו התנהגות מקובלת לניקוי טעות הקלדה,
  // אבל היא הסיבה שהאישור נוקב בשם הדירה ולא במזהה.
  apartment: (id) => Promise.all([count("tickets", db.ticket.count({ where: { apartmentId: id } }))]),

  domain: (id) => Promise.all([count("tickets", db.ticket.count({ where: { domainId: id } }))]),

  // שיוכים נספרים **כולל `REMOVED`**: נמען שהוסר מפנייה נשאר בהיסטוריה שלה,
  // ומחיקתו הייתה מוחקת את השורה "הוסר מהפנייה" מהשרשור.
  // ‏`AccessToken` אינו נספר — קישור אישי חסר משמעות בלי בעליו, ונכון שימות
  // איתו. ‏`MediaFile.uploaderProfessionalId` הוא SetNull, אך כל מי שהעלה קובץ
  // היה בהכרח משויך לפנייה, ולכן הוא נחסם ממילא דרך השיוך.
  professional: (id) =>
    Promise.all([
      count("assignments", db.assignment.count({ where: { professionalId: id } })),
      count("messages", db.message.count({ where: { authorProfessionalId: id } })),
    ]),

  // ‏`TagAccess` של התגית אינו נחשב חוסם: הגישה היא הרשאה על התגית עצמה,
  // ובלעדיה אין לה קיום. מה שחוסם הוא **תוכן** — פניות שקובצו וצ׳אט שנכתב.
  tag: (id) =>
    Promise.all([
      count("taggedTickets", db.ticketTag.count({ where: { tagId: id } })),
      count("tagMessages", db.message.count({ where: { tagId: id } })),
    ]),

  // ⚠️ המשתמש הוא הישות היחידה שההפניות אליה אינן `Restrict` בלבד:
  // `Ticket.handlerId`, `Ticket.closedById` ו-`MediaFile.uploaderUserId` הם
  // `SetNull`. זו בדיוק הסיבה שהאפיון אסר עליו מחיקה עד הכרעת 1.0 — מחיקה
  // שנשענת על ה-DB בלבד הייתה מוחקת בשקט את "מי מטפל" ואת "מי סגר" מפניות
  // קיימות. הספירה כאן היא מה שמייתר את האיסור: היא חוסמת על שלוש ההפניות
  // האלה בדיוק כמו על השאר, ולכן מה שנמחק הוא רק משתמש שלא נגע בכלום.
  //
  // שלושת התפקידים בפנייה נספרים כמונה **אחד**: המנהל צריך לדעת בכמה פניות
  // הוא מעורב, ואותה פנייה שהוא גם פתח, גם טיפל בה וגם סגר הייתה נספרת
  // שלוש פעמים ונקראת כשלוש פניות שונות.
  user: (id) =>
    Promise.all([
      count(
        "tickets",
        db.ticket.count({
          where: { OR: [{ createdById: id }, { handlerId: id }, { closedById: id }] },
        }),
      ),
      count("assignments", db.assignment.count({ where: { userId: id } })),
      count("messages", db.message.count({ where: { authorUserId: id } })),
      count("createdTags", db.tag.count({ where: { createdById: id } })),
      // המדיה נספרת במפורש, בשונה מ-`professional` שם היא הושמטה במכוון:
      // קבלן שהעלה קובץ היה בהכרח משויך לפנייה ולכן נחסם דרך השיוך, אבל
      // מנהל מערכת יכול להעלות קובץ לכל פנייה בלי שיוך ובלי הודעה — ואז
      // לא היה נשאר מונה שחוסם, והקובץ היה מתייתם ב-SetNull.
      count("uploadedMedia", db.mediaFile.count({ where: { uploaderUserId: id } })),
    ]),
};

/** כל ההפניות החוסמות שקיימות בפועל. רשימה ריקה פירושה שהמחיקה פנויה. */
export async function countBlockingReferences(
  entity: DeletableEntity,
  id: string,
): Promise<BlockingReference[]> {
  const all = await COUNTERS[entity](id);
  return all.filter((reference) => reference.count > 0);
}

/** "‏3 פניות, בניין אחד" — הפירוט שנכנס לתוך הודעת החסימה */
export function describeBlockers(references: readonly BlockingReference[]): string {
  return references.map((r) => he.admin.blockedBy[r.kind](r.count)).join(", ");
}

/**
 * שער המחיקה. כל פעולת מחיקה בשירותים קוראת לו לפני שהיא נוגעת ב-DB.
 * זורק שגיאה מוסברת אם קיימות הפניות, ואינו עושה דבר אם המחיקה פנויה.
 */
export async function assertDeletable(entity: DeletableEntity, id: string): Promise<void> {
  const blockers = await countBlockingReferences(entity, id);
  if (blockers.length > 0) {
    throw new DeletionBlockedError(he.admin.deleteBlocked(describeBlockers(blockers)));
  }
}
