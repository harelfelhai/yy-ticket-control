import { Banner } from "yy-ticket-control";

/**
 * הודעת מצב מתמשך — לא תוצאה של לחיצה שהמשתמש עשה עכשיו, ולכן היא יושבת
 * על משטח משלה ולא כשורת טקסט צבועה.
 */
export function Tones() {
  return (
    <div className="flex max-w-md flex-col gap-3">
      <Banner tone="success">הפנייה נשלחה לשני אנשי מקצוע והיא ממתינה לאישורם.</Banner>
      <Banner tone="warning">טיוטה — חסרים פרטים. לא נשלחה לאיש.</Banner>
      <Banner tone="brand">שוחזר מה שהקלדת קודם. אפשר להמשיך מהמקום שבו הפסקת.</Banner>
    </div>
  );
}

/** משפט ארוך — הבאנר עוטף לשורות ושומר על ריפוד אחיד. */
export function LongText() {
  return (
    <div className="max-w-md">
      <Banner tone="warning">
        הפנייה הועברה לאישור המנהל מפני שסכום העבודה חורג מהתקרה שהוגדרה לאתר הזה. עד לאישור היא
        אינה נשלחת לאיש מקצוע ואינה מופיעה בלוח העבודה שלו.
      </Banner>
    </div>
  );
}
