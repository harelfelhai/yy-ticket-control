import type { MailOutcome } from "@/generated/prisma/enums";
import { cardClasses } from "@/components/ui/card";
import { chipClasses } from "@/components/ui/chip";
import { formatDateTime } from "@/lib/format";
import { he } from "@/lib/he";
import type { CorrespondenceAttachment, CorrespondenceMessage } from "@/lib/services/email-correspondence";
import { CARD_LIST, LINK, ROW_LIST, TITLE_DESCRIPTIVE } from "@/lib/ui";

/**
 * התכתבות המייל של פנייה — המייל המקורי, התשובות שנקלטו והמיילים שהמערכת
 * שלחה, לפי הסדר (אפיון §3.2 שדה 20, מסך 7, EM-M01).
 *
 * **Server Component, `<details>` נייטיב.** ההתכתבות היא היסטוריה שקוראים
 * לפי הצורך. אין בה כפתורים — רק קישורי הורדה לקבצים, בתוך היסטוריה מקופלת,
 * כמו הארכיון שבלוח (DESIGN.md § פאנל מתקפל). **המייל האחרון פתוח, הקודמים
 * מקופלים** — זה מה שהאפיון קובע למסך 7. אחרי תשובה, האחרון הוא בדרך כלל
 * המייל החוזר עליה, שיוצא באותה טרנזאקציה ואומר מה השתנה בטיוטה.
 *
 * **בתוך המערכת ולא כקישור לתיבה**: קישור לתיבה נפתח רק למי שמחובר אליה,
 * והתיבה משותפת עם מערכת אחרת.
 *
 * אותו רכיב משמש גם את חלון "פרטים" אחרי השיגור (מסך 2, EM-S2-01) — שם
 * ההתכתבות **אינה חלק מהשרשור**: השרשור הוא השיחה עם הנמענים, וההתכתבות
 * הייתה עם השולח.
 */
export function EmailCorrespondence({ messages }: { messages: CorrespondenceMessage[] }) {
  return (
    <section aria-label={he.emailDraft.correspondence} className="flex flex-col gap-2">
      <h2 className={TITLE_DESCRIPTIVE}>{he.emailDraft.correspondence}</h2>
      {messages.length === 0 ? (
        <p className="text-sm text-muted">{he.emailDraft.noCorrespondence}</p>
      ) : (
        // כל מייל הוא כרטיס נפרד, ולכן ריתמוס של רשימת כרטיסים (§ ריתמוס)
        <ul className={CARD_LIST}>
          {messages.map((message, index) => (
            <li key={message.id}>
              <CorrespondenceItem message={message} open={index === messages.length - 1} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const KILOBYTES = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });

/** גודל בקילובייטים, מעוגל כלפי מעלה — קובץ של 300 בייט אינו "0 KB" */
function kilobytes(sizeBytes: number): string {
  return KILOBYTES.format(Math.max(1, Math.ceil(sizeBytes / 1024)));
}

function CorrespondenceItem({ message, open }: { message: CorrespondenceMessage; open: boolean }) {
  const when = message.receivedAt ?? message.sentAt ?? message.createdAt;
  const note = noteOf(message);

  return (
    <details open={open} className={cardClasses(undefined, { padding: "compact" })}>
      {/*
       * **ה-`<summary>` נשאר `list-item` ואינו `flex`.** `display:flex` עליו
       * מוחק את משולש הפתיחה הנייטיב, וזה הרמז היחיד שמייל מקופל נפתח (אותו
       * לקח של ארכיון הפורטל, `p/[token]/page.tsx`).
       *
       * **והשורה בתוכו היא טקסט רגיל, לא `inline-flex`.** קופסת `inline-flex`
       * היא יחידה אחת שאינה נשברת: כשהיא רחבה ממה שנשאר אחרי המשולש, היא
       * יורדת כולה לשורה הבאה, וכרום מפסיק לצייר את המשולש — וכך בטלפון בכל
       * שורה עם הערה (נמדד ב-393px). טקסט רגיל נשבר אחרי המשולש כמו כל פסקה.
       * הרווח בין החלקים הוא `me-2` על כל חלק (`META`).
       *
       * שורת מטא-דאטה ולא כותרת תיאורית: הפאנל הוא פריט ברשימה, לא אזור
       * במסך (DESIGN.md § התכתבות המייל). `min-h-8` — אזור לחיצה לכל דבר.
       */}
      <summary className="min-h-8 cursor-pointer py-1 text-sm">
        {message.direction === "INBOUND" ? (
          <InboundSender message={message} />
        ) : (
          <>
            <span className={`${META} font-medium`}>{he.emailDraft.systemSender}</span>
            {message.toAddress ? (
              <span className={`${META} text-muted`}>
                {he.emailDraft.sentTo} <bdi dir="ltr">{message.toAddress}</bdi>
              </span>
            ) : null}
          </>
        )}
        <span className={`${META} text-xs text-muted tabular-nums`}>
          <bdi dir="ltr">{formatDateTime(when)}</bdi>
        </span>
        {/* הסיבה במילים ולא בצבע בלבד; הצבע לפי חומרה — ראה `noteOf` */}
        {note ? (
          <span className={`text-sm ${note.tone === "danger" ? "text-danger" : "text-muted"}`}>{note.text}</span>
        ) : null}
      </summary>

      <div className="flex flex-col gap-2 pt-2">
        {message.subject ? (
          <p className="text-xs text-muted">
            {he.emailDraft.subjectLabel} <bdi>{message.subject}</bdi>
          </p>
        ) : null}
        {message.bodyText ? (
          // `wrap-break-word`: קישור ארוך בחתימה הוא מילה אחת ברוחב מאות
          // פיקסלים, ובלי שבירה הוא גולל את כל העמוד הצידה בטלפון
          <p className="whitespace-pre-wrap wrap-break-word text-base leading-relaxed">{message.bodyText}</p>
        ) : (
          <p className="text-sm text-muted">{he.emailDraft.emptyBody}</p>
        )}
        {message.attachments.length > 0 ? (
          <ul aria-label={he.emailDraft.attachments} className={ROW_LIST}>
            {message.attachments.map((attachment) => (
              <AttachmentRow key={attachment.id} attachment={attachment} />
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

/**
 * רווח בין חלקי שורת הסיכום. **על עוטף בכיוון השורה, לא על ה-`<bdi dir="ltr">`
 * עצמו:** `me-2` על אלמנט LTR יושב בצד ימין שלו, כלומר בצד הלא נכון בשורה
 * עברית — והמועד היה נצמד להערה שאחריו.
 */
const META = "me-2";

/**
 * שולח של מייל נכנס: השם, והכתובת לצדו. כתובת היא מחרוזת לועזית בתוך שורה
 * עברית, ולכן תמיד ב-`<bdi dir="ltr">` — גם כשהיא לבדה, בלי שם תצוגה.
 */
function InboundSender({ message }: { message: CorrespondenceMessage }) {
  if (message.fromName) {
    return (
      <>
        <span className={`${META} font-medium`}>{message.fromName}</span>
        {message.fromAddress ? (
          <span className={`${META} text-muted`}>
            <bdi dir="ltr">{message.fromAddress}</bdi>
          </span>
        ) : null}
      </>
    );
  }
  return message.fromAddress ? (
    <span className={`${META} font-medium`}>
      <bdi dir="ltr">{message.fromAddress}</bdi>
    </span>
  ) : null;
}

/**
 * קובץ מצורף: קישור הורדה רק כשיש לו בתים שמורים (`downloadable`). לכל השאר
 * — שם, גודל ומה קרה לקובץ, במילים. קישור לקובץ בלי בתים היה מחזיר 404.
 */
function AttachmentRow({ attachment }: { attachment: CorrespondenceAttachment }) {
  const name = attachment.filename ?? he.emailDraft.unnamedAttachment;
  const reason = attachment.downloadable
    ? null
    : (attachment.skippedReason && he.emailDraft.attachmentSkipped[attachment.skippedReason]) ||
      he.emailDraft.attachmentUnavailable;

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      {attachment.downloadable ? (
        /*
         * `<a>` רגיל ולא `ButtonLink`: הוא `next/link`, שהיה מנסה ניווט
         * צד-לקוח ו-prefetch לנתיב שמגיש קובץ. הקובץ מוגש דרך route שבודק
         * הרשאה (`api/email-attachments/[id]`), לא כתובת ישירה לאובייקט.
         * `min-h-7`: קישור שהוא פעולה בשורה כפוף לגובה פקד (§ אזורי מגע).
         */
        <a href={`/api/email-attachments/${attachment.id}`} className={`inline-flex min-h-7 items-center ${LINK}`}>
          {name}
        </a>
      ) : (
        <span>{name}</span>
      )}
      <span className="text-xs text-muted tabular-nums" dir="ltr">
        {he.emailDraft.fileSize(kilobytes(attachment.sizeBytes))}
      </span>
      {reason ? <span className={chipClasses("neutral")}>{reason}</span> : null}
    </li>
  );
}

type Note = { text: string; tone: "danger" | "muted" };

/**
 * מה לומר על מייל שהתכתבותו נרשמה אבל לא שינה דבר בטיוטה — או על מייל
 * יוצא שלא יצא. הכרעות שכן נקלטו אינן צריכות שורה: הטיוטה עצמה היא התוצאה.
 *
 * **הצבע לפי חומרה** (§ Colors: `danger` הוא עבודה שנעצרה, לא הדגשה): מייל
 * שתוכנו לא נכנס ושליחה שנכשלה — `danger`. דילוג צפוי (הטיוטה שוגרה או
 * נמחקה, §7 שורה 77) וסביבה בלי ערוץ מייל — מידע, `muted`.
 */
function noteOf(message: CorrespondenceMessage): Note | null {
  if (message.direction === "INBOUND") {
    if (!message.outcome) return null;
    const text = (he.emailDraft.outcome as Partial<Record<MailOutcome, string>>)[message.outcome];
    return text ? { text, tone: "danger" } : null;
  }
  switch (message.state) {
    case "SKIPPED":
      return message.skippedAfterClose
        ? { text: he.emailDraft.sendSkipped, tone: "muted" }
        : { text: he.emailDraft.sendNotSent, tone: "danger" };
    case "FAILED":
      return { text: he.emailDraft.sendFailed, tone: "danger" };
    case "SIMULATED":
      return { text: he.emailDraft.sendSimulated, tone: "muted" };
    default:
      return null;
  }
}
