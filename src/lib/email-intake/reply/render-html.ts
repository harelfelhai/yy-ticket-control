import { EMAIL_CONTAINER_OPEN, EMAIL_PARAGRAPH_STYLE, escapeHtml } from "@/lib/notifier/compose";

/**
 * המבנה של מייל חוזר לשולח, והרינדור שלו ל-HTML.
 *
 * **הטקסט וה-HTML נגזרים מאותו מבנה, ולא ה-HTML מהטקסט.** המייל הכללי
 * מדגיש כותרות ומכיל קישור באמצע משפט ("…לנמענים: [קישור]. אם משהו לא
 * נכון…"). ניחוש של גבולות הקישור או הכותרת מתוך טקסט שטוח היה נשבר על
 * הערך הראשון שמכיל נקודתיים או כתובת — ושני מסלולי ניסוח נפרדים היו
 * נפרדים בנוסח עם הזמן. כאן יש מסלול אחד: `compose.ts` בונה פסקאות
 * ממקטעים, והקובץ הזה הופך אותן לטקסט (`paragraphText`) ול-HTML.
 */

export type ReplySegment =
  | { kind: "text"; text: string }
  /** כותרת חלק, או המשפט שהאפיון מדגיש ("הטיוטה עוד לא נשלחה לאיש.") */
  | { kind: "strong"; text: string }
  | { kind: "link"; href: string };

/** פסקה = רצף מקטעים. ירידת שורה בתוך מקטע נשמרת (`<br>`). */
export type ReplyParagraph = readonly ReplySegment[];

/**
 * קישור לחיץ רק כשהוא http(s). הקישורים נבנים מכתובת המערכת ולא מקלט של
 * שולח, אבל ערך שגוי בהגדרה עדיין לא אמור להפוך ל-`javascript:` לחיץ בתיבה
 * של אדם אמיתי — הוא מוצג כטקסט, והתקלה נראית במקום להיות מנוצלת.
 */
function isWebLink(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function multiline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function segmentHtml(segment: ReplySegment): string {
  switch (segment.kind) {
    case "text":
      return multiline(segment.text);
    case "strong":
      return `<strong>${multiline(segment.text)}</strong>`;
    case "link": {
      const href = escapeHtml(segment.href);
      return isWebLink(segment.href) ? `<a href="${href}">${href}</a>` : href;
    }
  }
}

/** הטקסט השטוח של פסקה — אותו רצף מקטעים, בלי סימון */
export function paragraphText(paragraph: ReplyParagraph): string {
  return paragraph.map((segment) => (segment.kind === "link" ? segment.href : segment.text)).join("");
}

/**
 * `<div dir="rtl">` עם סגנון מוטבע — אותה מעטפת כמו ההתראות לנמענים
 * (`renderEmailHtml`). בלי כותרת `<h1>` ובלי חתימה: המייל הוא תשובה בתוך
 * שרשרת שהשולח פתח, ונוסח האפיון אינו כולל אותן.
 */
export function renderIntakeReplyHtml(paragraphs: readonly ReplyParagraph[]): string {
  const body = paragraphs
    .map((paragraph) => `<p style="${EMAIL_PARAGRAPH_STYLE}">${paragraph.map(segmentHtml).join("")}</p>`)
    .join("");
  return `${EMAIL_CONTAINER_OPEN}${body}</div>`;
}
