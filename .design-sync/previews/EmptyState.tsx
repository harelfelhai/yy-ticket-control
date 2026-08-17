import { ButtonLink, EmptyState } from "yy-ticket-control";

/**
 * מצב ריק מזמין לפעולה ולא מביע מצב רוח: משפט אחד שמסביר מה יופיע כאן,
 * ואם יש פעולה שתמלא אותו — כפתור אליה.
 */
export function WithAction() {
  return (
    <EmptyState action={<ButtonLink href="/tickets/new">+ פנייה חדשה</ButtonLink>}>
      עדיין אין פניות באתר הזה. פנייה שתיפתח תופיע כאן ותישלח לאיש המקצוע שתבחר.
    </EmptyState>
  );
}

/**
 * בלי פעולה — כשהיא כבר צפה על המסך במקום אחר (ה-FAB בלוח), כפתור שני הוא
 * כפילות ולא הזמנה.
 */
export function WithoutAction() {
  return <EmptyState>אין פניות שמתאימות למסננים שבחרת.</EmptyState>;
}
