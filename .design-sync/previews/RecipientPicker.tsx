import { useState } from "react";
import { RecipientPicker } from "yy-ticket-control";

/**
 * בחירת נמעני הפנייה — אנשי מקצוע ומשתמשים פנימיים באותה רשימה. בנוי מעל
 * `LearnedSelect`, ולכן אפשר להוסיף איש מקצוע חדש מתוך הזרימה בלי לעזוב
 * את הטופס.
 */

const options = [
  { id: "p1", label: "מוסא דיאב", hint: "אינסטלציה · 050-1234567", kind: "professional" as const },
  { id: "p2", label: "אבי כהן", hint: "חשמל · 052-7654321", kind: "professional" as const },
  { id: "p3", label: "רונן לוי", hint: "מיזוג · 054-1112233", kind: "professional" as const },
  { id: "u1", label: "יוסי — מנהל עבודה", hint: "משתמש במערכת", kind: "user" as const },
];

const noop = async () => options[0];

/** בלי נמענים — כך נראה שדה הנמענים בפנייה חדשה. */
export function Empty() {
  const [value, setValue] = useState<typeof options>([]);
  return (
    <div className="max-w-sm">
      <RecipientPicker
        options={options}
        value={value}
        onChange={setValue}
        onCreateProfessional={noop}
      />
    </div>
  );
}

/** נמען אחד נבחר. */
export function OneRecipient() {
  const [value, setValue] = useState([options[0]]);
  return (
    <div className="max-w-sm">
      <RecipientPicker
        options={options}
        value={value}
        onChange={setValue}
        onCreateProfessional={noop}
      />
    </div>
  );
}

/** כמה נמענים — כאן נראית ההסרה ("הסר נמען") לצד כל אחד. */
export function ManyRecipients() {
  const [value, setValue] = useState([options[0], options[1], options[3]]);
  return (
    <div className="max-w-sm">
      <RecipientPicker
        options={options}
        value={value}
        onChange={setValue}
        onCreateProfessional={noop}
      />
    </div>
  );
}
