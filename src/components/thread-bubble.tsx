import type { ReactNode } from "react";
import { formatTime } from "@/lib/format";
import type { ThreadMessageView } from "@/lib/thread-view";
import { MediaAttachments } from "./media-attachments";

/**
 * בועת הודעה בשרשור — רכיב אחד לשלושת המקומות שמרנדרים שיחה:
 * מסך הפנייה הפנימי, פורטל הקבלן, וצ׳אט התגית — וגם לשיחת הוואטסאפ (1.4), שמוסיפה
 * לבועה מצב מסירה, קבצים שלא נשמרו והערה דרך שני חריצים (`status`, `children`).
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
interface ThreadBubbleProps {
  message: ThreadMessageView;
  /**
   * שם הכותב גם בבועה שבצד "שלי". בשרשור הצד הזה הוא הצופה, ושמו מיותר; בשיחת
   * הוואטסאפ הוא המערכת, שאינה הצופה (DESIGN.md § שיחת הוואטסאפ).
   */
  authorAlways?: boolean;
  /** לפני השעה, באותה שורה — מצב המסירה של הודעת מערכת בשיחת הוואטסאפ */
  status?: ReactNode;
  /**
   * הטקסט כפי שהוא מוצג — בשיחת הוואטסאפ, עם ההדגשה של וואטסאפ. המעטפת (`<p>`
   * והשבירה) נשארת של הבועה; הקורא קובע רק מה בתוכה.
   */
  formatText?: (text: string) => ReactNode;
  /** אחרי המדיה — קבצים שלא נשמרו והערה במילים (שיחת הוואטסאפ) */
  children?: ReactNode;
}

export function ThreadBubble({ message, authorAlways = false, status, formatText, children }: ThreadBubbleProps) {
  /*
   * **ההבחנה עברה מהמילוי למסגרת, ובעל כורחה.**
   *
   * עד המעבר לגרפיט הזוג היה `bg-brand/10` מול `bg-bg`, ואז שניהם היו
   * צבעים שונים. עכשיו `bg-brand/10` הוא כמעט-לבן מעורבב בכמעט-שחור —
   * בפועל ‏#e8e9ea — ורקע העמוד הוא ‏#eff1f3. כלומר **שתי הבועות התכנסו
   * לאותו אפור**, ובנוסף בועת "אחרים" ב-`bg-bg` יושבת על עמוד שצבעו
   * `bg-bg` בדיוק, כלומר חדלה להיות בועה. זו אינה החמרה אסתטית אלא
   * היעלמות: השרשור נקרא כרצף פסקאות בלי גבולות.
   *
   * שתיהן עוברות ל-`bg-surface` — הלבן הוא מה שמפריד מהעמוד האפור, וזה
   * בדיוק כלל ההפרדה של התקן (§ Elevation: מסגרת ומשטח, לא צל) — ומה
   * שמבחין ביניהן הוא **צבע המסגרת**: גרפיט לבועה של הצופה, אפור-גבול
   * לשאר. גרפיט על ‏#ccd1d6 הוא ניגוד גבוה גם בשמש, בניגוד לכל רמז של
   * מילוי בעשרה אחוזים.
   *
   * ‏`border-brand` כאן אינו הפרה של "מותג אינו מצב": הבועה אינה
   * affordance ואינה סטטוס — המסגרת אומרת "זה שלך", בדיוק המשמעות
   * שהצ׳יפ נותן לטון `brand`.
   *
   * הצבע ממילא אינו נושא את המידע לבדו: שם הכותב מוצג בכל בועה שאינה של
   * הצופה, וההבחנה נעשית גם ביישור. ראו DESIGN.md § נגישות.
   */
  const surface = message.own
    ? "self-end border-brand"
    : "self-start border-border";

  return (
    /*
     * ‏`max-w-96` (‏384px) ולא `max-w-[85%]`: `layout-guards.test.ts` אוסר גם
     * על ערך שרירותי בסוגריים וגם על שם גודל, ומתיר `max-w` מספרי כאילוץ
     * פקד. הבועה ממילא מתכווצת לתוכן (`self-start`/`self-end` על ילד flex),
     * ולכן הערך תוחם רק הודעות ארוכות.
     *
     * **‏`rounded-lg` (‏8px) — הכרעה ולא שריד.** הבועה ישבה על `rounded-2xl`,
     * שהיה **רמת המיכל בסקאלה הישנה**; אילו ירשה את הסקאלה החדשה כפי שהיא
     * הייתה יורדת ל-6px של `cardClasses` ונקראת כשורת כרטיס. הצורה כאן היא
     * חלק מהמשמעות — עיגול נדיב הוא מה שאומר "דיבור" — ולכן היא עולה דרגה
     * אחת מעל המיכל ונעצרת שם. זה עדיין בתוך הסקאלה החדשה, ולא 16px שנשארו
     * במקומם מפני שאיש לא הסתכל.
     *
     * ‏`border` ולא `cardClasses`: הכרטיס קובע גם רדיוס וגם ריפוד, ושניהם
     * שונים כאן בכוונה — כלומר קריאה לו הייתה דריסה של רוב מה שהוא נותן.
     *
     * **‏`px-2 py-1` ולא `px-3 py-2` — סבב הצ׳אט.** הריפוד שהיה כאן הוא ריפוד
     * של **כרטיס**, ובועה אינה כרטיס: היא פריט אחד ברצף של עשרות, וכל 4px
     * אנכיים מוכפלים במספר ההודעות. בשרשור טיפוסי זה היה הפרש של מסך שלם.
     * ההקטנה נעשית **בריפוד בלבד** — טקסט ההודעה נשאר `text-base`, כי
     * ‏`text-xs` הוא בתקן תפקיד של מטא-דאטה ולא תחליף לטקסט גוף (§ Typography).
     */
    <div
      className={`flex max-w-96 flex-col gap-1 rounded-lg border bg-surface px-2 py-1 ${surface}`}
    >
      {message.own && !authorAlways ? null : (
        <p className="text-xs font-medium text-muted">{message.authorName}</p>
      )}

      {/*
       * `wrap-anywhere` ולא `wrap-break-word`: קישור הוא מילה אחת ברוחב מאות
       * פיקסלים. הבועה מתכווצת לתוכן, ורוחבה אינו קטן מהמילה הארוכה ביותר שבה —
       * ו-`break-word` אינו משנה את המדידה הזו, רק את השבירה אחרי שהרוחב נקבע.
       * ב-390px הבועה יצאה מהכרטיס שמאלה ונחתכה. ב-RTL גלישה שמאלה גם אינה
       * יוצרת גלילה, ולכן אין לה שום סימן חוץ מהטקסט החתוך (נמדד, W8).
       */}
      {message.text ? (
        <p className="whitespace-pre-wrap wrap-anywhere">{formatText ? formatText(message.text) : message.text}</p>
      ) : null}

      <MediaAttachments media={message.media} />

      {children}

      {status ? (
        <div className="flex flex-wrap items-center gap-2 self-end">
          {status}
          <BubbleTime at={message.createdAt} />
        </div>
      ) : (
        <BubbleTime at={message.createdAt} className="self-end" />
      )}
    </div>
  );
}

/**
 * שעה היא מספר: `tabular-nums` מונע קפיצה בין שורות, ו-`dir="ltr"` מונע היפוך של
 * "16:45" ל-"45:16" בהקשר RTL.
 */
function BubbleTime({ at, className = "" }: { at: Date; className?: string }) {
  return (
    <time dateTime={at.toISOString()} dir="ltr" className={`${className} text-xs tabular-nums text-muted`.trim()}>
      {formatTime(at)}
    </time>
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
