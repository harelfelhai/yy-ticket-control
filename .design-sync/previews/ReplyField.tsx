import { useState } from "react";
import { Button, ReplyField } from "yy-ticket-control";

/**
 * שדה כתיבת תגובה בשרשור. רכיב מבוקר — הערך והשינוי שייכים למסך שמחזיק
 * את הטופס, ולכן התצוגה כאן עוטפת אותו ב-`useState` כדי להראות אותו חי.
 */

/** ריק — כך הוא נראה כשנכנסים לפנייה. */
export function Empty() {
  const [value, setValue] = useState("");
  return (
    <div className="max-w-md">
      <ReplyField value={value} onChange={setValue} />
    </div>
  );
}

/** עם טקסט שהוקלד, לצד כפתור השליחה. */
export function Filled() {
  const [value, setValue] = useState(
    "אפשר לעבור מחר בבוקר? הדיירת בבית עד 11:00.",
  );
  return (
    <div className="flex max-w-md flex-col gap-3">
      <ReplyField value={value} onChange={setValue} />
      <Button className="self-start">שלח</Button>
    </div>
  );
}

/** מושבת — בזמן שליחה, או כשהפנייה נסגרה. */
export function Disabled() {
  return (
    <div className="max-w-md">
      <ReplyField value="הפנייה נסגרה — לא ניתן להשיב." onChange={() => {}} disabled />
    </div>
  );
}
