"use client";

import { useState } from "react";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { addTagMessageAction } from "../actions";
import { FormError } from "@/components/ui/message";
import { ReplyField } from "@/components/reply-field";

/**
 * תיבת הכתיבה בצ׳אט התגית, לצד הפנימי (מנהלים).
 *
 * כאן — ובכוונה — יש בורר מדיה: דוח בדק בית וצילומי מצב מתפרסמים בצ׳אט
 * הקבוצתי בידי המנהל. הצד של הקבלן בפורטל כותב טקסט בלבד, כי רישום מדיה
 * בלי הקשר של פנייה פתוח למשתמשים פנימיים בלבד (ראה `registerMedia`).
 */
export function TagChatBox({ tagId }: { tagId: string }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const { busy, error, run } = useAction();

  const canSend = text.trim().length > 0 || files.length > 0;

  function send() {
    run(
      () => addTagMessageAction(tagId, text, files.map((f) => f.mediaId)),
      () => {
        setText("");
        setFiles([]);
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ReplyField value={text} onChange={setText} />

      <MediaPicker files={files} onChange={setFiles} disabled={busy} />

      <Button disabled={busy || !canSend} onClick={send} className="self-start">
        {he.ticket.send}
      </Button>

      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
