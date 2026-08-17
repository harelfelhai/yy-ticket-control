import { useState } from "react";
import { LearnedSelect } from "yy-ticket-control";

/**
 * בורר מותאם עם חיפוש ו"צור חדש" — הבורר שלומד. הוא נבדל מ-`Select` הנייטיב
 * בכך שאפשר להקליד לתוכו ולהוסיף ערך שלא היה קיים, ולכן הוא משמש לשדות
 * שהתוכן שלהם נצבר תוך כדי עבודה (בניין, תחום, איש מקצוע).
 *
 * ‏`.control-chevron` — אותה מחלקה בדיוק כמו `Select` — היא מה שמבטיח ששני
 * הבוררים נראים זהים. פקד שנבדל רק בפרט מקרי נקרא כרשלנות, לא כהבחנה.
 */

const buildings = [
  { id: "1", label: "בן גוריון 14", hint: "רמת השרון" },
  { id: "2", label: "סוקולוב 3", hint: "הרצליה" },
  { id: "3", label: "ויצמן 22", hint: "כפר סבא" },
];

/** נבחר ערך — המצב הרגיל אחרי בחירה. */
export function Selected() {
  const [value, setValue] = useState<string | null>("1");
  return (
    <div className="max-w-sm">
      <LearnedSelect label="בניין" options={buildings} value={value} onChange={setValue} />
    </div>
  );
}

/** ריק — ה-placeholder הוא מה שמסביר מה בוחרים כאן. */
export function Empty() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="max-w-sm">
      <LearnedSelect
        label="תחום"
        options={[
          { id: "1", label: "אינסטלציה" },
          { id: "2", label: "חשמל" },
          { id: "3", label: "מיזוג" },
        ]}
        value={value}
        onChange={setValue}
        placeholder="בחר תחום"
      />
    </div>
  );
}

/** מושבת — למשל בפנייה שכבר שוגרה. */
export function Disabled() {
  return (
    <div className="max-w-sm">
      <LearnedSelect
        label="בניין"
        options={buildings}
        value="2"
        onChange={() => {}}
        disabled
      />
    </div>
  );
}
