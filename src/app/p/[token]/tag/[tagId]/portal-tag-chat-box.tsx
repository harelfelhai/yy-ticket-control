"use client";

import { useState, useTransition } from "react";
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
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">{he.ticket.reply}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          className="rounded-xl border border-border bg-surface p-3 text-base"
        />
      </label>

      <button
        type="button"
        disabled={busy || text.trim().length === 0}
        onClick={send}
        className="min-h-12 self-start rounded-xl bg-brand px-6 font-semibold text-brand-fg disabled:opacity-60"
      >
        {he.ticket.send}
      </button>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
