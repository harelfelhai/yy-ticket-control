import { ThreadDaySeparator } from "yy-ticket-control";

/**
 * מפריד יום בין הודעות שנכתבו בימים שונים. אינו הודעה ולכן אינו `<li>`
 * ברשימה — הוא נגזר מהנתונים ומופרד מהם.
 */
export function Default() {
  return <ThreadDaySeparator label="יום שלישי, 12 באוגוסט" />;
}

/** בתוך שרשור — שם הוא מקבל את משמעותו. */
export function InThread() {
  return (
    <div className="flex max-w-md flex-col gap-2">
      <ThreadDaySeparator label="אתמול" />
      <div className="flex max-w-96 flex-col gap-1 self-start rounded-2xl bg-bg px-3 py-2">
        <p className="text-xs font-medium text-muted">מוסא דיאב</p>
        <p>הגעתי לדירה, צריך חלק שאין לי ברכב. אחזור מחר בבוקר.</p>
      </div>
      <ThreadDaySeparator label="היום" />
      <div className="flex max-w-96 flex-col gap-1 self-end rounded-2xl bg-brand/10 px-3 py-2">
        <p>מצוין, תודה. תעדכן כשסיימת.</p>
      </div>
    </div>
  );
}
