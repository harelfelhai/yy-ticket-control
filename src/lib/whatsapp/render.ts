import { he } from "@/lib/he";
import {
  type IntakeReplyInput,
  type ReplyParagraph,
  type ReplyTemplate,
  buildReplyBody,
  greetingText,
} from "@/lib/intake/reply-model";
import { MAX_TEXT_LENGTH } from "./send";

/**
 * ניסוח הודעת האישור בוואטסאפ — "ההודעות היוצאות בוואטסאפ" (סוף §4 באפיון).
 *
 * הכללים — אילו חלקים, באיזה סדר ומתי — משותפים למייל (`intake/reply-model.ts`).
 * מה שהוואטסאפ מוסיף כאן הוא רק מה ששייך לצ'אט: הנוסח (`he.whatsappIntake`),
 * הברכה בתחילת המשפט הראשון, ההדגשה של וואטסאפ (`*…*`) והגג על אורך ההודעה.
 * **פונקציה טהורה** — הודעה שיצאה לאדם אמיתי אי אפשר להחזיר, ולכן כל חלק נבדק
 * כאן בלי רשת ובלי בסיס נתונים.
 */

const t = he.whatsappIntake;

export interface ComposedWhatsappReply {
  template: ReplyTemplate;
  text: string;
}

export function composeWhatsappReply(input: IntakeReplyInput): ComposedWhatsappReply {
  const composed = compose(input);
  if (composed.text.length <= MAX_TEXT_LENGTH) return composed;

  // הגג של וואטסאפ (4096). רק התיאור ארוך בלי גבול — הוא מה שהשולח כתב ואמר —
  // ולכן הוא היחיד שמתקצר, ובדיוק בכמה שצריך. התיאור המלא נשאר בטיוטה (§7 שורה 112).
  const description = input.summary?.description ?? "";
  const overflow = composed.text.length - MAX_TEXT_LENGTH;
  const keep = description.length - overflow - t.truncated.length;
  if (!input.summary || keep <= 0) {
    // הודעה שחורגת מהגג גם בלי תיאור היא באג בשכבה שמעל; Meta הייתה דוחה אותה
    throw new Error(`composeWhatsappReply: ההודעה ארוכה מ-${MAX_TEXT_LENGTH} תווים גם בלי התיאור`);
  }
  return compose({ ...input, summary: { ...input.summary, description: `${description.slice(0, keep).trimEnd()}${t.truncated}` } });
}

function compose(input: IntakeReplyInput): ComposedWhatsappReply {
  const { template, paragraphs } = buildReplyBody(input, t);
  const [first = [], ...rest] = paragraphs;
  // "שלום [שם], ההודעה שלך נשמרה…" — הברכה פותחת את הפסקה הראשונה, באותה שורה
  const opening: ReplyParagraph = [{ kind: "text", text: `${greetingText(input.recipientName, t)} ` }, ...first];
  return { template, text: [opening, ...rest].map(renderParagraph).join("\n\n") };
}

/**
 * פסקה כטקסט של וואטסאפ. **הדגשה היא `*…*`**, ווואטסאפ מכירה בה רק כשהכוכביות
 * צמודות לאות — ולכן רווחים בקצוות המקטע יוצאים אל מחוץ לכוכביות. קישור הוא
 * הכתובת עצמה: וואטסאפ הופכת אותה ללחיצה, והתצוגה המקדימה כבויה בשליחה.
 */
function renderParagraph(paragraph: ReplyParagraph): string {
  return paragraph
    .map((segment) => {
      switch (segment.kind) {
        case "text":
          return segment.text;
        case "link":
          return segment.href;
        case "strong": {
          const core = segment.text.trim();
          if (!core) return segment.text;
          const lead = segment.text.slice(0, segment.text.indexOf(core));
          const trail = segment.text.slice(lead.length + core.length);
          return `${lead}*${core}*${trail}`;
        }
      }
    })
    .join("");
}
