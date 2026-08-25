"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { AddMediaButton } from "@/components/add-media-button";
import { AttachedFiles } from "@/components/attached-files";
import { AudioRecorder } from "@/components/audio-recorder";
import { type AttachedFile, toFileList, useMediaUpload } from "@/lib/use-media-upload";
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
  const [recording, setRecording] = useState(false);
  const { busy, error, run } = useAction();
  const media = useMediaUpload({ files, onChange: setFiles, disabled: busy });

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
      {/* שורת הקלטה אחת, כמו במסך הפנייה — ראו את ההנמקה ב-`ticket-actions`. */}
      <AttachedFiles media={media} />

      <div className="flex items-end gap-2">
        {recording ? null : <AddMediaButton media={media} />}

        {recording ? null : (
          <div className="flex-1">
            <ReplyField value={text} onChange={setText} />
          </div>
        )}

        {canSend && !recording ? (
          <Button size="compact" disabled={busy} onClick={send} aria-label={he.ticket.send}>
            <Send className="size-3" aria-hidden="true" />
          </Button>
        ) : null}

        <AudioRecorder
          icon
          hidden={canSend}
          disabled={media.busy}
          onRecordingChange={setRecording}
          onRecorded={(file) => void media.addFiles(toFileList(file))}
          onError={media.setError}
        />
      </div>

      {media.error ? <FormError>{media.error}</FormError> : null}

      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
