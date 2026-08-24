"use client";

import { useState } from "react";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { markDoneAction, replyAction } from "./actions";
import { cardClasses } from "@/components/ui/card";
import { Banner, FormError } from "@/components/ui/message";
import { ReplyField } from "@/components/reply-field";

interface PortalActionsProps {
  token: string;
  ticketId: string;
  status: AssignmentStatus;
  isClosed: boolean;
  /** שם הפותח — מוצג בהודעות "הועברה לאישור X" (אפיון מסך 8) */
  openerName: string;
}

/**
 * הפעולות שהנמען רשאי לבצע: תגובה ו"סיימתי — טופל".
 *
 * **הנמען אינו סוגר** (אפיון §5.א). "טופל" ממנו הוא דיווח, לא אימות, ולכן
 * הכפתור אומר "סיימתי — טופל" ולא "סגור", וההודעה שאחריו מבהירה שהמנהל
 * הוא זה שסוגר. הבהרה כאן חוסכת טלפון של "סגרתי, למה זה עדיין פתוח?".
 *
 * **"יש לי שאלה" הוסר ב-0.4** (אפיון §7 שורה 31). שאלה נשלחת כהודעה רגילה
 * בתיבת התגובה, וההודעה עצמה היא שמחזירה את הפנייה לפותח ומסמנת אותה
 * בלוח כממתינה למענה. הכפתור דרש מהקבלן לסווג את עצמו לפני שכתב, יצר שני
 * מסלולים לאותה פעולה — ובאחד מהם, כתיבה בתיבה בלי ללחוץ עליו, ההודעה לא
 * הגיעה לאיש — והיה הערוץ היחיד שדרכו הודעה מהשטח נראתה בכלל.
 */
export function PortalActions({
  token,
  ticketId,
  status,
  isClosed,
  openerName,
}: PortalActionsProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const { busy, error, run } = useAction();

  // תגובה יכולה להיות תמונה בלבד — וזה המקרה השכיח כאן: קבלן מצלם את מה
  // שתיקן במקום לתאר אותו במילים.
  const canReply = text.trim().length > 0 || files.length > 0;

  function clear() {
    setText("");
    setFiles([]);
  }

  if (isClosed) {
    return (
      <p className={cardClasses("text-sm text-muted")}>
        {he.notices.closedTicketBlocked}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {status === "DONE" ? (
        <Banner tone="success">{he.portal.doneNotice(openerName)}</Banner>
      ) : null}

      <ReplyField value={text} onChange={setText} />

      <MediaPicker
        ticketId={ticketId}
        token={token}
        files={files}
        onChange={setFiles}
        disabled={busy}
      />

      <div className="flex flex-col gap-2">
        {/* `Button` ולא `<button>`: זהו `secondary` רגיל, והכתיבה-מהזיכרון
            כאן כבר סטתה — `px-4` (הריפוד של `compact`) על גובה `default`. */}
        <Button
          variant="secondary"
          className="w-full"
          disabled={busy || !canReply}
          onClick={() =>
            run(
              () => replyAction(token, ticketId, text, files.map((f) => f.mediaId)),
              clear,
            )
          }
        >
          {he.ticket.send}
        </Button>

        {/*
         * **הכפתור הירוק בן 56px עבר ל-`Button` ב-`primary`**, וההחרגה שלו
         * ב-`primitives.test.ts` נמחקה. שלוש סיבות, לפי סדר החומרה:
         *
         * ‏1. ‏`success` הוא **צבע מצב ולא צבע פעולה** (§ Colors: "לא `success`
         *    לאישור ויזואלי"). הכפתור אמר "טופל" לפני שהקבלן לחץ עליו — כלומר
         *    צבע ירוק על פעולה שטרם קרתה, בדיוק המידע השקרי שהסעיף אוסר.
         *    את בשורת ההצלחה נושא ה-`Banner` שמעליו, אחרי הלחיצה.
         * ‏2. **שפה אחת לשני הצדדים** (§ Overview: "קבלן שרואה ממשק זר חושד
         *    בו"). הפעולה המקבילה בצד הפנימי — "סגור פנייה" ב-`ticket-actions`
         *    — היא `Button` רגיל; אחרי סבב הצפיפות זה היה הכפתור היחיד במוצר
         *    בגובה 56px ובעיגול 12px, ובידוד כזה נקרא כמסך אחר ולא כהדגשה.
         * ‏3. ההיררכיה לא אבדה אלא נעשתה מפורשת: `primary` מול ה-`secondary`
         *    של "שלח" הוא בדיוק "זו הפעולה הראשית של המסך". `w-full` נשאר —
         *    זו פריסה, לא מראה, ורוחב מלא בטלפון הוא מה שהופך אותו למטרה
         *    שאי אפשר לפספס. ‏44px במגע מגיעים מ-`touch:` שבפרימיטיב.
         */}
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => run(() => markDoneAction(token, ticketId))}
        >
          {he.portal.markDone}
        </Button>
      </div>

      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
