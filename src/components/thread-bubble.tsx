import { formatTime } from "@/lib/format";
import type { ThreadMessageView } from "@/lib/thread-view";
import { MediaAttachments } from "./media-attachments";

/**
 * בועת הודעה בשרשור — רכיב אחד לשלושת המקומות שמרנדרים שיחה:
 * מסך הפנייה הפנימי, פורטל הקבלן, וצ׳אט התגית.
 *
 * **למה זו כפילות אמיתית שראויה לרכיב.** התקן מזהיר במפורש ש"לא כל כפילות
 * היא רכיב", וארבעת הקומפוזרים נשארו נפרדים בכוונה. אבל כאן האפיון קובע
 * דרישה מפורשת (§2.3): "לשני הצדדים אותה שפה ויזואלית — קבלן שרואה ממשק
 * זר חושד בו". שלושת העותקים שקדמו נבדלו ברדיוס בלבד (`rounded-lg` מול
 * `rounded-xl`), כלומר כבר התחילו לסחוף.
 *
 * רכיב **שרת** בהכרח: הוא מפרמט זמן, ו-`format.ts` קובע שפורמט בצד הלקוח
 * הוא שגיאת hydration אצל משתמש עם אזור זמן אחר.
 *
 * הספציפיקציה ב-`docs/DESIGN.md` § בועת שרשור.
 */
export function ThreadBubble({ message }: { message: ThreadMessageView }) {
  // הצבע אינו נושא את המידע לבדו: שם הכותב מוצג בכל בועה שאינה של הצופה,
  // וההבחנה נעשית גם ביישור. ראו DESIGN.md § נגישות.
  const surface = message.own ? "self-end bg-brand/10" : "self-start bg-bg";

  return (
    // ‏`max-w-96` (384px) ולא `max-w-[85%]`: `layout-guards.test.ts` אוסר גם
    // על ערך שרירותי בסוגריים וגם על שם גודל, ומתיר `max-w` מספרי כאילוץ
    // פקד. הבועה ממילא מתכווצת לתוכן (`self-start`/`self-end` על ילד flex),
    // ולכן הערך תוחם רק הודעות ארוכות.
    <div className={`flex max-w-96 flex-col gap-1 rounded-2xl px-3 py-2 ${surface}`}>
      {message.own ? null : (
        <p className="text-xs font-medium text-muted">{message.authorName}</p>
      )}

      {message.text ? <p className="whitespace-pre-wrap">{message.text}</p> : null}

      <MediaAttachments media={message.media} />

      {/* שעה היא מספר: `tabular-nums` מונע קפיצה בין שורות, ו-`dir="ltr"`
          מונע היפוך של "16:45" ל-"45:16" בהקשר RTL. */}
      <time
        dateTime={message.createdAt.toISOString()}
        dir="ltr"
        className="self-end text-xs tabular-nums text-muted"
      >
        {formatTime(message.createdAt)}
      </time>
    </div>
  );
}

/**
 * מפריד יום בין הודעות שנכתבו בימים שונים.
 *
 * אינו הודעה ולכן אינו `<li>` ברשימה — הוא נגזר מהנתונים ומופרד מהם.
 */
export function ThreadDaySeparator({ label }: { label: string }) {
  return <p className="py-1 text-center text-xs text-muted">{label}</p>;
}
