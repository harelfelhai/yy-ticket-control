"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { portalTagMessageAction } from "./actions";

/**
 * תיבת הכתיבה של הקבלן בצ׳אט הקבוצתי — טקסט בלבד.
 *
 * הקבלן משתתף בדיון על קבוצת הליקויים במילים; דוחות וצילומים בצ׳אט מגיעים
 * מהמנהל. ההסבר המלא ב-`portalTagMessageAction`.
 */
export function PortalTagChatBox({ token, tagId }: { token: string; tagId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await portalTagMessageAction(token, tagId, text);
      if (result.ok) setText("");
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={he.ticket.reply}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
      </Field>

      <Button
        disabled={busy || text.trim().length === 0}
        onClick={send}
        className="self-start"
      >
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
