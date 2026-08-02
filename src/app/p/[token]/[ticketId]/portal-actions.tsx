"use client";

import { useState, useTransition } from "react";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { askQuestionAction, markDoneAction, replyAction } from "./actions";
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
 * הפעולות שהנמען רשאי לבצע: תגובה, "סיימתי — טופל", ו"יש לי שאלה".
 *
 * **הנמען אינו סוגר** (אפיון §5.א). "טופל" ממנו הוא דיווח, לא אימות, ולכן
 * הכפתור אומר "סיימתי — טופל" ולא "סגור", וההודעה שאחריו מבהירה שהמנהל
 * הוא זה שסוגר. הבהרה כאן חוסכת טלפון של "סגרתי, למה זה עדיין פתוח?".
 *
 * "יש לי שאלה" דורש טקסט: שאלה בלי תוכן היא רק דגל אדום שמנהל העבודה לא
 * יודע מה לעשות איתו.
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  // תגובה יכולה להיות תמונה בלבד — וזה המקרה השכיח כאן: קבלן מצלם את מה
  // שתיקן במקום לתאר אותו במילים.
  const canReply = text.trim().length > 0 || files.length > 0;

  function clear() {
    setText("");
    setFiles([]);
  }

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) onSuccess?.();
      else setError(result.error);
    });
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
      {status === "QUESTION" ? (
        <Banner tone="warning">{he.portal.questionNotice(openerName)}</Banner>
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
            ההחרגה של הקובץ נועדה לשני הכפתורים שמתחת, לא לו. */}
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
          // שאלה דורשת טקסט גם כשמצורפת תמונה: תמונה בלי מילים אינה שאלה
          // שמנהל העבודה יודע לענות עליה.
          disabled={busy || text.trim().length === 0}
          onClick={() =>
            run(
              () => askQuestionAction(token, ticketId, text, files.map((f) => f.mediaId)),
              clear,
            )
          }
          className="min-h-12 rounded-xl border border-warning bg-warning/10 px-4 font-semibold text-warning disabled:opacity-60"
        >
          {he.portal.askQuestion}
        </button>

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
