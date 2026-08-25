"use client";

import { Send } from "lucide-react";
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
      {/*
       * אין כאן `MediaPicker` — הקבלן כותב טקסט בלבד (ראו למעלה), ולכן
       * השורה מחזיקה שדה וכפתור שליחה בלבד.
       *
       * **וכאן כפתור השליחה נשאר מוצג ומושבת**, בשונה משלושת הקומפוזרים
       * האחרים שמסתירים אותו כשאין מה לשלוח. שם ההסתרה מפנה את המקום
       * למיקרופון; כאן אין מיקרופון שייכנס במקומו, והסתרה הייתה משאירה
       * שורה שאין בה שום פקד מלבד התיבה.
       */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <ReplyField value={text} onChange={setText} />
        </div>

        <Button
          size="compact"
          disabled={busy || text.trim().length === 0}
          onClick={send}
          aria-label={he.ticket.send}
        >
          <Send className="size-3" aria-hidden="true" />
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
