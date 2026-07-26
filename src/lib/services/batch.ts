import type { Room } from "@/generated/prisma/enums";
import { UserFacingError } from "@/lib/action-result";
import { he } from "@/lib/he";
import { normalizeName, normalizeText } from "@/lib/normalize";
import type { SessionUser } from "@/lib/session";
import { toViewer } from "@/lib/session";
import { assertLocationInSite } from "./directory";
import { addTagMessage, findOrCreateTag } from "./tags";
import { type RecipientRef, createTicket } from "./tickets";

/**
 * הזנה מרוכזת מדוח בדק בית (מסך 5).
 *
 * זהו המסך שעונה על התרחיש המתפרץ: דירה אחת, עשרות ליקויים, ובעלי מקצוע
 * שונים. בניין, דירה ותגית משותפים לכל הפניות; כל שורה היא פנייה נפרדת.
 *
 * שתי הכרעות עקרוניות:
 *
 * 1. **שורה חסרת נמען נשמרת כטיוטה, לא נדחית.** זהו אותו כלל של "פנייה לא
 *    הולכת לאיבוד" (§5.ב): מנהל שהזין 28 ליקויים ולאחד לא ידע עדיין את
 *    הקבלן, לא אמור לאבד את ה-27 האחרים. הסיכום אומר במפורש כמה נשמרו.
 * 2. **דוח המקור יושב בצ׳אט התגית**, לא על כל פנייה בנפרד. הוא הקשר של
 *    הקבוצה כולה, הטקסט שבו נסרק ונעשה זמין לחיפוש (§ מסך 5, אזור א׳).
 */

export class BatchError extends UserFacingError {}

export interface BatchRow {
  description: string;
  domainId?: string | null;
  room?: Room | null;
  /** נמען יחיד לשורה. חסרונו הופך את השורה לטיוטה. */
  recipient?: RecipientRef | null;
}

export interface CreateBatchInput {
  siteId: string;
  buildingId: string;
  apartmentId: string;
  /** התגית המשותפת שכל הפניות מקובצות תחתיה (אזור ג׳) */
  tagName: string;
  /** דוח הבדק וצילומי המסך — נכנסים כהודעה הפותחת בצ׳אט התגית */
  sourceMediaIds?: string[];
  rows: BatchRow[];
  /** "שגר הכל" מול "שמור הכל כטיוטה" */
  dispatch: boolean;
}

export interface BatchResult {
  tagId: string;
  /** פניות ששוגרו בפועל (לא טיוטות) */
  created: number;
  drafts: number;
  /** מספר אנשי המקצוע השונים ששויכו — למונה בסיכום */
  professionals: number;
  /** האם שוגר בכלל, או שהכול נשמר כטיוטה */
  dispatched: boolean;
}

/**
 * שורה נכנסת לחישוב רק אם יש בה תיאור **ותחום** — שני שדות החובה שהמסך
 * דורש לכל שורה. שורה ריקה (שהמשתמש הוסיף ולא מילא) פשוט נשמטת, ואינה
 * נספרת כטיוטה — אחרת כל לחיצה על "הוסף שורה" הייתה מזהמת את הסיכום.
 */
function isMeaningfulRow(row: BatchRow): boolean {
  return Boolean(normalizeText(row.description) && row.domainId);
}

export async function createTicketBatch(
  actor: SessionUser,
  input: CreateBatchInput,
): Promise<BatchResult> {
  if (!input.buildingId || !input.apartmentId) throw new BatchError(he.batch.needLocation);

  // אימות מוקדם, פעם אחת לפני הלולאה: הבניין והדירה משותפים לכל השורות,
  // וכשל כאן עדיף על יצירת חלק מהפניות ואז נפילה על מזהה חוצה-אתרים.
  await assertLocationInSite({
    siteId: input.siteId,
    buildingId: input.buildingId,
    apartmentId: input.apartmentId,
  });

  const tagName = normalizeName(input.tagName);
  if (!tagName) throw new BatchError(he.batch.needTag);

  const rows = input.rows.filter(isMeaningfulRow);
  if (rows.length === 0) throw new BatchError(he.batch.needRows);

  const tag = await findOrCreateTag(tagName, actor.id);

  const dispatchedProfessionals = new Set<string>();
  let created = 0;
  let drafts = 0;

  // שיגור שורה-שורה בכוונה, ולא טרנזאקציה אחת על כל הדוח (הכרעת מימוש 0.2):
  // כשל בשורה 17 מתוך 28 משאיר את 16 הראשונות שנוצרו, במקום לבטל את כולן —
  // עקבי עם "פנייה לא הולכת לאיבוד". כל createTicket הוא טרנזאקציה בפני עצמה.
  for (const row of rows) {
    // שורה בלי נמען נשמרת כטיוטה גם ב"שגר הכל". "שמור הכל כטיוטה" הופך
    // את כולן לטיוטות ללא קשר לנמען.
    const saveAsDraft = !input.dispatch || !row.recipient;

    const { isDraft } = await createTicket(actor, {
      siteId: input.siteId,
      buildingId: input.buildingId,
      apartmentId: input.apartmentId,
      domainId: row.domainId ?? null,
      room: row.room ?? null,
      description: row.description,
      recipients: row.recipient ? [row.recipient] : [],
      tagIds: [tag.id],
      saveAsDraft,
    });

    if (isDraft) {
      drafts += 1;
    } else {
      created += 1;
      if (row.recipient?.kind === "professional") dispatchedProfessionals.add(row.recipient.id);
    }
  }

  // דוח המקור נכנס פעם אחת, כהודעה פותחת בצ׳אט התגית. אחרי יצירת הפניות
  // בכוונה: אם משהו בהן נכשל, לא נשאר דוח יתום בצ׳אט של תגית ריקה.
  if (input.sourceMediaIds?.length) {
    await addTagMessage(toViewer(actor), tag.id, "", input.sourceMediaIds);
  }

  return {
    tagId: tag.id,
    created,
    drafts,
    professionals: dispatchedProfessionals.size,
    dispatched: input.dispatch,
  };
}
