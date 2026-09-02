"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { Banner } from "@/components/ui/message";
import { he } from "@/lib/he";
import { type WaPendingRecipient, whatsAppPath } from "@/lib/notifier/wa-share";
import { CARD_LIST } from "@/lib/ui";

/**
 * "נותר לשלוח בוואטסאפ" — רשימת הנמענים שהמערכת **אינה** יכולה ליידע.
 *
 * זה הפאנל שסוגר את הפער התפעולי החד ביותר במערכת: המערכת שולחת מייל
 * אוטומטית, אבל קבלן שיש לו טלפון ואין לו מייל אינו מקבל דבר — והפנייה
 * שלו נראית בלוח **בדיוק** כמו פנייה ששוגרה בהצלחה. עד כאן ההגנה היחידה
 * הייתה שמנהל העבודה יזכור ללחוץ על כפתור הוואטסאפ.
 *
 * **למה רשימה ולא רק פתיחה אוטומטית.** הלשונית נפתחת אוטומטית לנמען
 * הראשון (ראה `openWhatsAppTab`), אבל חוסם החלונות הקופצים יחסום כל אחת
 * שאחריה — ובחלק מהדפדפנים גם את הראשונה. רשימה שנשארת על המסך עד
 * שנלחצה עובדת בכל מקרה, לנמען אחד ולחמישה, וגם כשהמנהל חזר למסך למחרת.
 *
 * **השורה נעלמת בלחיצה, ולא ממתינה לשרת.** התיעוד קורה בנתיב `/api/wa/…`
 * שנפתח בלשונית, ו-`router.refresh()` שיוצא באותו רגע **מריץ מירוץ מולו** —
 * בריצה שנמדדה הרינדור ניצח, השורה חזרה מלאה, והמנהל היה שולח פעמיים
 * בדיוק למי שזה עתה שלח לו. מצב מקומי הוא התשובה הנכונה כאן: מבחינת המנהל
 * הפעולה הסתיימה ברגע שהוואטסאפ נפתח. רענון הדף מציג את מה שבשרת, ולכן
 * שורה שהתיעוד שלה נכשל תחזור — וזה הכיוון הבטוח מבין השניים.
 */
export function WaPendingPanel({ recipients }: { recipients: WaPendingRecipient[] }) {
  const router = useRouter();
  const titleId = useId();
  const [sent, setSent] = useState<string[]>([]);

  const open = recipients.filter((r) => !sent.includes(r.assignmentId));
  if (open.length === 0) return null;

  return (
    /*
     * ‏`aria-labelledby` ולא `aria-label`: הכותרת **נראית**, ושתי הצורות
     * יחד היו מקריאות אותה פעמיים — אותו שיקול בדיוק כמו בנגן האודיו
     * (`media-attachments.tsx`). וכותרת נראית ולא רק נגישה, מפני שמה
     * שנשאר על המסך בלעדיה הוא משפט אזהרה בלי שם למשימה שהוא מתאר.
     */
    <div
      role="group"
      aria-labelledby={titleId}
      className={cardClasses("flex flex-col gap-2")}
    >
      <p id={titleId} className="text-sm font-medium">
        {he.ticket.waPendingTitle}
      </p>
      <Banner tone="warning">{he.ticket.waPendingHint}</Banner>

      <ul className={CARD_LIST}>
        {open.map((recipient) => (
          /*
           * ‏`gap` ולא `justify-between` (DESIGN.md § Layout): הכפתור פועל
           * על השם שלצדו, ודחיפתו לקצה הנגדי במסך רחב מנתקת אותו ממנו.
           * ‏`min-w-0 truncate` על השם — שם ארוך מקצר את עצמו במקום למעוך
           * את הכפתור, בדיוק כמו בשורת הנמען.
           */
          <li key={recipient.assignmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 truncate">{recipient.name}</span>
            {/*
             * קישור ולא `<button>`, וזו אינה בחירת סגנון: פתיחת לשונית
             * חייבת לבוא מהמחווה עצמה. פתיחה מתוך תשובה אסינכרונית נחסמת
             * כחלון קופץ — דווקא בדפדפני המובייל שבהם זה נחוץ.
             *
             * ‏`onClick` מרענן בלבד ואינו מתעד: התיעוד קורה בשרת, בתוך
             * הנתיב, **לפני** ההפניה. בנייד ההפניה מוסרת את השליטה
             * לאפליקציית וואטסאפ, וכל מה שהיה נדחה לכאן עלול לא לקרות.
             */}
            <a
              href={whatsAppPath(recipient.assignmentId)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setSent((current) => [...current, recipient.assignmentId]);
                // הרענון עדכן גם את שורת החיווי שליד הנמען ("נפתח בוואטסאפ").
                router.refresh();
              }}
              aria-label={`${he.ticket.sendWhatsApp} ${recipient.name}`}
              className={buttonClasses("primary", "compact", "shrink-0")}
            >
              {he.ticket.sendWhatsApp}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * פותח לשונית **בתוך המחווה** ומפנה אותה כשהתשובה מהשרת חוזרת.
 *
 * זה הטריק היחיד שעובד: `window.open` מותר רק בזמן טיפול באירוע משתמש
 * ("‏transient activation"), וקריאה אליו אחרי `await` של Server Action כבר
 * נמצאת מחוץ לחלון הזה ונחסמת. לכן הלשונית נפתחת ריקה מיד, וממתינה.
 *
 * מחזיר פונקציה שמקבלת את היעד — או `null` כשאין למה להפנות, ואז הלשונית
 * נסגרת. **חוסם שחסם את הפתיחה מחזיר `null`, וזה מצב תקין ולא שגיאה**:
 * הנמען עדיין מופיע ב-`WaPendingPanel` במסך שאליו המנהל נוחת.
 */
export interface WhatsAppTab {
  (assignmentId: string | null): void;
  /**
   * האם באמת נפתחה לשונית.
   *
   * **נשלח לשרת, ואינו קישוט.** השרת מסמן את הנמען כ"נפתח" כבר בפעולה
   * עצמה — אחרת מסך הפנייה מתרנדר לפני שהלשונית הספיקה לדווח, והנמען
   * שהוואטסאפ שלו נפתח לנגד עיני המנהל מופיע ברשימת "נותר לשלוח" (נמדד).
   * אבל סימון כזה עבור לשונית **שנחסמה** היה מסתיר את המשימה היחידה
   * שנשארה, ולכן השרת חייב לדעת מה קרה כאן בפועל.
   */
  opened: boolean;
}

export function openWhatsAppTab(): WhatsAppTab {
  const tab = typeof window === "undefined" ? null : window.open("", "_blank");

  const settle = ((assignmentId: string | null) => {
    if (!tab) return;
    if (assignmentId) tab.location.href = whatsAppPath(assignmentId);
    else tab.close();
  }) as WhatsAppTab;

  settle.opened = tab !== null;
  return settle;
}
