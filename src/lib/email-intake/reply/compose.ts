import { he } from "@/lib/he";
import {
  type IntakeReplyInput,
  type ReplyTemplate,
  buildReplyBody,
  greetingText,
  paragraphText,
} from "@/lib/intake/reply-model";
import { renderIntakeReplyHtml } from "./render-html";

/**
 * ניסוח המייל החוזר לשולח מייל פנייה — "המיילים היוצאים לשולח" (סוף §4
 * באפיון), §7 שורות 71–72.
 *
 * הכללים — אילו חלקים, באיזה סדר ומתי — משותפים לכל הערוצים
 * (`intake/reply-model.ts`). מה שהמייל מוסיף כאן הוא רק מה ששייך למייל:
 * הנוסח (`he.emailIntake`), הפנייה בשם כפסקה נפרדת, הכותרת `Re:` וה-HTML.
 */

export interface ComposeIntakeReplyInput extends IntakeReplyInput {
  originalSubject: string;
}

export interface ComposedIntakeReply {
  template: ReplyTemplate;
  subject: string;
  text: string;
  html: string;
}

const t = he.emailIntake;

export function composeIntakeReply(input: ComposeIntakeReplyInput): ComposedIntakeReply {
  const { template, paragraphs: body } = buildReplyBody(input, t);
  const paragraphs = [[{ kind: "text" as const, text: greetingText(input.recipientName, t) }], ...body];

  return {
    template,
    subject: replySubject(input.originalSubject),
    text: paragraphs.map(paragraphText).join("\n\n"),
    html: renderIntakeReplyHtml(paragraphs),
  };
}

/**
 * `Re: <הכותרת המקורית>`, ובלי קידומת כפולה בתשובה לתשובה. הכותרת נכנסת
 * לכותרת MIME, ולכן ירידת שורה בתוכה מוחלפת ברווח — אחרת היא הייתה פותחת
 * כותרת נוספת בהודעה.
 */
function replySubject(original: string): string {
  const subject = original.replace(/[\r\n]+/g, " ").trim();
  if (subject.toLowerCase().startsWith(t.replyPrefix.toLowerCase())) return subject;
  return subject ? `${t.replyPrefix} ${subject}` : t.replyPrefix;
}
