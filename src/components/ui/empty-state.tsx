import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * מצב ריק — מקור אמת אחד.
 *
 * **מצב ריק מזמין לפעולה, לא מביע מצב רוח** (`docs/DESIGN.md` § EmptyState):
 * משפט אחד שמסביר מה יופיע כאן, ואם יש פעולה שתמלא אותו — כפתור אליה. אין
 * איורים ואין "אין כלום כאן 🎉".
 *
 * החילוץ מצא שתי בעיות. הראשונה שכיחה: אותו מצב ריק נכתב ב-`py-8` בשלושה
 * מסכים וב-`py-12` בשלושה אחרים. השנייה מהותית יותר — **לאף מצב ריק במערכת
 * לא הייתה פעולה**, כלומר איש מהם לא עמד בתקן. `action` נשאר אופציונלי
 * במכוון: במסכים שבהם הפעולה כבר צפה על המסך (ה-FAB בלוח), כפתור שני הוא
 * כפילות ולא הזמנה.
 */
interface EmptyStateProps {
  /** משפט אחד: מה יופיע כאן, ולמה ריק עכשיו */
  children: ReactNode;
  /** הפעולה שתמלא את המסך. מושמטת כשהיא כבר זמינה במקום אחר בעמוד. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ children, action, className }: EmptyStateProps) {
  return (
    <div className={twMerge("flex flex-col items-center gap-4 py-12 text-center", className)}>
      <p className="text-muted">{children}</p>
      {action}
    </div>
  );
}
