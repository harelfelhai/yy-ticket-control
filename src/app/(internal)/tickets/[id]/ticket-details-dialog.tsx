"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { he } from "@/lib/he";
import { DIALOG_SCROLL_BODY } from "@/lib/ui";

/**
 * "פרטים" — כל מה שמסביב לשיחה, מאחורי כפתור.
 *
 * **למה דיאלוג ולא פאנל מתקפל.** עד 0.4 ישב כאן `<details>` **בין** הכותרת
 * לשרשור, כלומר בין המשתמש לבין מה שהוא בא לקרוא. הדיווח מהשטח היה שמסך
 * הפנייה אינו נקרא כשיחה, וההשוואה שחידדה זאת היא הפורטל: שם הקבלן מקבל
 * כותרת, מיד את השרשור, וקומפוזר — ואיש לא התלונן עליו.
 *
 * המעבר גם פותר בעיה שהייתה ידועה ומתועדת: תוכן של `<details>` סגור מוסר
 * מעץ הנגישות. `getByRole` תחתיו נפתר לאפס אלמנטים, כלומר לא רק שלחיצה
 * נכשלת — גם `toHaveCount(0)` הופך ירוק-שקר. דיאלוג סגור פשוט אינו
 * מרונדר, וזו הבחנה שקורא מסך וגם בדיקה יודעים לעשות.
 *
 * **מה נשאר בחוץ.** פעולות הפנייה ("סגור פנייה", "סמן: אני מטפל") והקומפוזר
 * נשארים ברצועה התחתונה: סגירת פנייה היא התוצאה של המסך ולא פרט מנהלי.
 * **וטיוטה אינה נכנסת לכאן כלל** — מסך ההשלמה הוא כל תכליתה של טיוטה,
 * והסתרתו מאחורי כפתור הייתה מחזירה בדיוק את התקלה שהמעבר הזה מתקן.
 *
 * הרכיב עוטף ואינו מחליף: `RecipientEditor`, `TicketTags` ו-`DeleteTicket`
 * נכנסים כ-`children` מהשרת, ולכן הם נשארים מרונדרים בשרת עם הנתונים שלהם
 * ואינם נטענים מחדש בכל פתיחה.
 */
export function TicketDetailsDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="compact" onClick={() => setOpen(true)}>
        {he.ticket.detailsPanel}
      </Button>

      {open ? (
        <Dialog title={he.ticket.detailsPanel} onClose={() => setOpen(false)}>
          {/* הגלילה על עוטף התוכן ולא על הפאנל: הכותרת וכפתור הסגירה
              חייבים להישאר גלויים גם כשהרשימה ארוכה. ראה § Dialog. */}
          <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>{children}</div>
        </Dialog>
      ) : null}
    </>
  );
}
