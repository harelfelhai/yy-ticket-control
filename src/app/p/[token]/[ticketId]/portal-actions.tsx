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
    <div className="flex flex-col gap-3">
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
            כאן כבר סטתה — `px-4` (הריפוד של `compact`) על גובה `default`.
            ההחרגה של הקובץ ב-`primitives.test.ts` נועדה לכפתור שמתחת, לא לו. */}
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

        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => markDoneAction(token, ticketId))}
          className="min-h-14 rounded-xl bg-success px-4 text-base font-semibold text-brand-fg disabled:opacity-60"
        >
          {he.portal.markDone}
        </button>
      </div>

      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
