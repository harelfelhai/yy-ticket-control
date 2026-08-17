import { MediaAttachments } from "yy-ticket-control";

/**
 * הקבצים המצורפים להודעה בשרשור. הרכיב בוחר תצוגה לפי סוג ה-MIME: תמונה,
 * וידאו, שמע עם נגן נייטיב, או קישור לקובץ.
 *
 * התמונות כאן הן data-URI כדי שהתצוגה תרונדר גם בלי רשת; במערכת עצמה
 * הכתובת עוברת דרך route שבודק הרשאה ומפנה לכתובת חתומה.
 */

const photo =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">
       <rect width="480" height="270" fill="#d6dae1"/>
       <rect x="150" y="80" width="180" height="110" rx="8" fill="#5a6472"/>
       <circle cx="200" cy="120" r="16" fill="#f3f5f8"/>
       <path d="M160 180 L215 130 L260 180 Z" fill="#131820"/>
       <path d="M250 180 L290 145 L320 180 Z" fill="#131820"/>
     </svg>`,
  );

/** תמונה שצולמה בשטח, עם טקסט שחולץ ממנה. */
export function Image() {
  return (
    <div className="max-w-sm">
      <MediaAttachments
        media={[
          {
            id: "1",
            url: photo,
            mimeType: "image/jpeg",
            name: "נזילה מתחת לכיור.jpg",
            aiText: null,
            aiNote: null,
          },
        ]}
      />
    </div>
  );
}

/** הקלטה קולית עם תמלול — כך נראה מה שה-AI הפיק מהקובץ. */
export function AudioWithTranscription() {
  return (
    <div className="max-w-sm">
      <MediaAttachments
        media={[
          {
            id: "2",
            url: "data:audio/mpeg;base64,",
            mimeType: "audio/mpeg",
            name: "הקלטה.m4a",
            aiText: "יש נזילה מתחת לכיור במטבח בדירה 4, המים כבר מגיעים למסדרון.",
            aiNote: null,
          },
        ]}
      />
    </div>
  );
}

/** קובץ שאינו מדיה — קישור בגובה אזור מגע. */
export function File() {
  return (
    <div className="max-w-sm">
      <MediaAttachments
        media={[
          {
            id: "3",
            url: "#",
            mimeType: "application/pdf",
            name: "הצעת מחיר.pdf",
            aiText: null,
            aiNote: "לא הופק טקסט — הקובץ סרוק ואינו קריא.",
          },
        ]}
      />
    </div>
  );
}

/** כמה קבצים בהודעה אחת. */
export function Multiple() {
  return (
    <div className="max-w-sm">
      <MediaAttachments
        media={[
          {
            id: "4",
            url: photo,
            mimeType: "image/jpeg",
            name: "לפני.jpg",
            aiText: null,
            aiNote: null,
          },
          {
            id: "5",
            url: "#",
            mimeType: "application/pdf",
            name: "חשבונית 4812.pdf",
            aiText: null,
            aiNote: null,
          },
        ]}
      />
    </div>
  );
}
