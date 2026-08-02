"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { portalTagMessageAction } from "./actions";
import { FormError } from "@/components/ui/message";
import { ReplyField } from "@/components/reply-field";

/**
 * תיבת הכתיבה של הקבלן בצ׳אט הקבוצתי — טקסט בלבד.
 *
 * הקבלן משתתף בדיון על קבוצת הליקויים במילים; דוחות וצילומים בצ׳אט מגיעים
 * מהמנהל. ההסבר המלא ב-`portalTagMessageAction`.
 */
export function PortalTagChatBox({ token, tagId }: { token: string; tagId: string }) {
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();

  function send() {
    run(
      () => portalTagMessageAction(token, tagId, text),
      () => setText(""),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ReplyField value={text} onChange={setText} />

      <Button
        disabled={busy || text.trim().length === 0}
        onClick={send}
        className="self-start"
      >
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
