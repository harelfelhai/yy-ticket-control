"use client";

import { useState, useTransition } from "react";
import { type AttachedFile, MediaPicker } from "@/components/media-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { addTagMessageAction } from "../actions";

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  const canSend = text.trim().length > 0 || files.length > 0;

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await addTagMessageAction(tagId, text, files.map((f) => f.mediaId));
      if (result.ok) {
        setText("");
        setFiles([]);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{he.ticket.reply}</span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
      </label>

      <MediaPicker files={files} onChange={setFiles} disabled={busy} />

      <Button disabled={busy || !canSend} onClick={send} className="self-start">
        {he.ticket.send}
      </Button>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
