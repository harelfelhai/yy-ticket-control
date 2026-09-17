import { he } from "@/lib/he";
import type { DraftFieldName } from "./fields";

/**
 * שם השדה כפי שהמשתמש מכיר אותו — **המקור היחיד** לו.
 *
 * אותו שם מופיע ב"חסרים: …" של השיגור, במייל החוזר לשולח ובשרשור ("עודכנו:
 * …"). שדה שנקרא במייל בשם אחר מזה שבמסך היה שולח את השולח לחפש שדה שאינו
 * קיים. הקובץ נפרד מ-`fields.ts` כדי שמודל השדות יישאר בלי תלות במחרוזות.
 */
export const DRAFT_FIELD_LABEL: Readonly<Record<DraftFieldName, string>> = {
  SITE: he.ticket.site,
  BUILDING: he.directory.building,
  APARTMENT: he.directory.apartment,
  ROOM: he.ticket.room,
  DOMAIN: he.directory.domain,
  DESCRIPTION: he.ticket.description,
  RECIPIENTS: he.ticket.recipients,
};
