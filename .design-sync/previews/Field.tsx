import { Field, Input, Select, Textarea } from "yy-ticket-control";

/** תווית גלויה + פקד. לעולם לא placeholder בלבד — הוא נעלם בהקלדה. */
export function Basic() {
  return (
    <div className="max-w-sm">
      <Field label="שם האתר">
        <Input defaultValue="רמת השרון, בן גוריון 14" />
      </Field>
    </div>
  );
}

/** הרמז מופיע מראש ולא רק אחרי כישלון. */
export function WithHint() {
  return (
    <div className="max-w-sm">
      <Field label="טלפון" hint="מספר נייד לשליחת הפנייה בוואטסאפ">
        <Input type="tel" defaultValue="050-1234567" />
      </Field>
    </div>
  );
}

/** השגיאה מוצגת **בנוסף** למסגרת האדומה ולא במקומה — צבע לבדו אינו נגיש. */
export function WithError() {
  return (
    <div className="max-w-sm">
      <Field label="אתר" error="יש לבחור אתר">
        <Select invalid defaultValue="">
          <option value="">בחר אתר</option>
          <option value="1">רמת השרון, בן גוריון 14</option>
          <option value="2">הרצליה, סוקולוב 3</option>
        </Select>
      </Field>
    </div>
  );
}

/** טופס שלם — כך הרכיב נראה בשימוש האמיתי שלו. */
export function InForm() {
  return (
    <div className="flex max-w-sm flex-col gap-4">
      <Field label="איש מקצוע">
        <Select defaultValue="2">
          <option value="1">אבי כהן — חשמל</option>
          <option value="2">מוסא דיאב — אינסטלציה</option>
        </Select>
      </Field>
      <Field label="תיאור התקלה" hint="מה לא עובד, ואיפה בדיוק">
        <Textarea rows={3} defaultValue="נזילה מתחת לכיור במטבח בדירה 4. המים מגיעים למסדרון." />
      </Field>
    </div>
  );
}
