import { Button, Dialog, Field, Input, Select } from "yy-ticket-control";

/**
 * הפאנל היחיד במערכת שלוכד את המשתמש: כל עוד הוא פתוח, מה שמאחוריו אינו
 * זמין. הוא נתלה על `<body>` דרך Portal כדי לצאת מכל הקשר ערימה של אבותיו,
 * ולכן הוא נראה כאן מעל המשטח כולו ולא בתוך תיבה.
 *
 * מרונדר תמיד פתוח: זהו מצבו היחיד: רכיב סגור אינו מרנדר דבר.
 */
export function Open() {
  return (
    <Dialog title="הוספת איש מקצוע" onClose={() => {}}>
      <div className="flex flex-col gap-3">
        <Field label="שם">
          <Input defaultValue="מוסא דיאב" />
        </Field>
        <Field label="תחום">
          <Select defaultValue="plumbing">
            <option value="plumbing">אינסטלציה</option>
            <option value="electric">חשמל</option>
          </Select>
        </Field>
        <Field label="טלפון" hint="מספר נייד לשליחת פניות בוואטסאפ">
          <Input type="tel" defaultValue="050-1234567" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button>שמור</Button>
          <Button variant="secondary">ביטול</Button>
        </div>
      </div>
    </Dialog>
  );
}
