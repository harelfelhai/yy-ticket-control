/**
 * הטיפוסים של מתאם המייל (אפיון §2.6, §5.ה3).
 *
 * המתאם ל-Gmail (`gmail-source.ts`) הוא המקום היחיד שמכיר את מבנה ה-API;
 * הוא מייצר `MailEnvelope`, והצינור מתרגם אותה לטיפוסים של ליבת הקליטה
 * (`intake/types.ts`), שמשותפים לכל הערוצים.
 */

/** כתובת מנורמלת (`normalizeEmail`) ושם תצוגה, אם היה */
export interface MailAddress {
  address: string;
  name: string | null;
}

/**
 * חלק בינארי בהודעה: קובץ מצורף או תמונה משובצת.
 *
 * **הבתים אינם כאן בהכרח.** Gmail מחזיר חלק קטן כ-`body.data` בתוך ההודעה
 * וחלק גדול כ-`attachmentId` שיש להוריד בנפרד. `data` מאוכלס כשהבתים כבר
 * בידינו, ו-`sourceRef` הוא מה שהמתאם צריך כדי להוריד אותם אחרת.
 */
export interface MailPart {
  /** מיקום החלק בעץ ה-MIME, בסדר הופעה. יציב בין קריאות של אותה הודעה. */
  index: number;
  filename: string | null;
  /** הסוג כפי שהוצהר בכותרת, מנורמל לאותיות קטנות ובלי פרמטרים */
  mimeType: string;
  sizeBytes: number;
  /** `Content-ID` בלי סוגריים משולשים */
  contentId: string | null;
  disposition: "attachment" | "inline" | null;
  data: Buffer | null;
  sourceRef: string | null;
}

export interface MailEnvelope {
  /** מזהה ההודעה במקור (Gmail message id) */
  sourceId: string;
  /** מזהה השרשור במקור (Gmail thread id) */
  sourceThreadId: string;
  /** `Message-ID`, מנורמל — ראה `normalizeMessageId` */
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  receivedAt: Date;
  /** כל הכותרות של החלק העליון, בשמות באותיות קטנות. ערך אחרון גובר. */
  headers: Record<string, string>;
  /** `Content-Type` של ההודעה כולה, מנורמל (למשל `multipart/report`) */
  contentType: string;
  /** הגוף כטקסט פשוט, מפוענח לפי ה-charset */
  text: string;
  /** הגוף כ-HTML, אם היה */
  html: string | null;
  parts: MailPart[];
}
