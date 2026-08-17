import { ThreadBubble } from "yy-ticket-control";

/**
 * בועת הודעה בשרשור — רכיב אחד לשלושת המקומות שמרנדרים שיחה: מסך הפנייה
 * הפנימי, פורטל הקבלן, וצ׳אט התגית. האפיון דורש שלשני הצדדים תהיה אותה
 * שפה ויזואלית: קבלן שרואה ממשק זר חושד בו.
 *
 * ‏`own` קובע את צד היישור ואת המשטח. הצבע אינו נושא את המידע לבדו — שם
 * הכותב מוצג בכל בועה שאינה של הצופה.
 */

const base = {
  media: [],
  createdAt: new Date("2026-08-17T16:45:00Z"),
};

/** הודעה נכנסת — יישור להתחלה, שם הכותב מוצג. */
export function Incoming() {
  return (
    <div className="flex max-w-md flex-col">
      <ThreadBubble
        message={{
          ...base,
          id: "1",
          authorName: "מוסא דיאב",
          own: false,
          text: "הגעתי לדירה. הנזילה היא מהצינור מתחת לכיור, צריך להחליף מחבר. יש לי את החלק ברכב.",
        }}
      />
    </div>
  );
}

/** הודעה יוצאת — יישור לסוף, בלי שם כותב. */
export function Own() {
  return (
    <div className="flex max-w-md flex-col">
      <ThreadBubble
        message={{
          ...base,
          id: "2",
          authorName: "יוסי — מנהל עבודה",
          own: true,
          text: "מצוין, תודה. תעדכן כשסיימת.",
        }}
      />
    </div>
  );
}

/** שיחה שלמה — כך שני הצדדים נראים זה מול זה. */
export function Conversation() {
  return (
    <div className="flex max-w-md flex-col gap-2">
      <ThreadBubble
        message={{
          ...base,
          id: "3",
          authorName: "יוסי — מנהל עבודה",
          own: true,
          text: "נזילה מתחת לכיור בדירה 4. אפשר להגיע היום?",
          createdAt: new Date("2026-08-17T09:12:00Z"),
        }}
      />
      <ThreadBubble
        message={{
          ...base,
          id: "4",
          authorName: "מוסא דיאב",
          own: false,
          text: "אני באזור אחרי 14:00, אעבור.",
          createdAt: new Date("2026-08-17T09:30:00Z"),
        }}
      />
      <ThreadBubble
        message={{
          ...base,
          id: "5",
          authorName: "מוסא דיאב",
          own: false,
          text: "סיימתי. החלפתי מחבר ובדקתי שאין נזילה נוספת.",
          createdAt: new Date("2026-08-17T16:45:00Z"),
        }}
      />
    </div>
  );
}

/** הודעה ארוכה — הבועה חסומה ב-384px ושוברת שורות. */
export function LongText() {
  return (
    <div className="flex max-w-md flex-col">
      <ThreadBubble
        message={{
          ...base,
          id: "6",
          authorName: "מוסא דיאב",
          own: false,
          text: "בדקתי את כל הדירה. חוץ מהכיור במטבח יש גם נזילה קטנה באמבטיה, מהברז ולא מהצנרת. אני יכול לטפל בשתיהן באותה הגעה, אבל צריך אישור על התוספת לפני שאני מזמין חלקים.",
        }}
      />
    </div>
  );
}
