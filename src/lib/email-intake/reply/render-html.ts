import type { ReplyParagraph, ReplySegment } from "@/lib/intake/reply-model";
import { EMAIL_CONTAINER_OPEN, EMAIL_PARAGRAPH_STYLE, escapeHtml } from "@/lib/notifier/compose";

/**
 * הרינדור של מייל חוזר לשולח ל-HTML.
 *
 * **הטקסט וה-HTML נגזרים מאותו מבנה, ולא ה-HTML מהטקסט.** המייל הכללי
 * מדגיש כותרות ומכיל קישור באמצע משפט ("…לנמענים: [קישור]. אם משהו לא
 * נכון…"). ניחוש של גבולות הקישור או הכותרת מתוך טקסט שטוח היה נשבר על
 * הערך הראשון שמכיל נקודתיים או כתובת — ושני מסלולי ניסוח נפרדים היו
 * נפרדים בנוסח עם הזמן. כאן יש מסלול אחד: `intake/reply-model.ts` בונה
 * פסקאות ממקטעים, ומשם הן הופכות לטקסט (`paragraphText`) ול-HTML (כאן).
 */

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
