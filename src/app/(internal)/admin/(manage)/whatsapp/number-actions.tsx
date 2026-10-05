"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormNotice } from "@/components/ui/message";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { createWhatsappTemplatesAction, disconnectWhatsappAction, sendWhatsappTestAction } from "./actions";

/**
 * הפקדים הקטנים של מסך 17 — כל אחד פעולה אחת, והתוצאה מתחת לכפתור שלה
 * (DESIGN.md § מסך 17). המצב עצמו נגזר מה-props: אחרי כל פעולה ה-RSC מרנדר מחדש.
 */

/** "נתק" — `window.confirm` בנוסח האפיון, ברירת המחדל לפעולה הרסנית */
export function DisconnectButton() {
  const action = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          variant="dangerOutline"
          disabled={action.busy}
          onClick={() => {
            if (!window.confirm(he.whatsappAdmin.disconnectConfirm)) return;
            action.run(() => disconnectWhatsappAction());
          }}
        >
          {he.whatsappAdmin.disconnect}
        </Button>
      </div>
      {action.error ? <FormError>{action.error}</FormError> : null}
    </div>
  );
}

/**
 * "שלח הודעת בדיקה". **אינו מושבת כשהתבנית לא אושרה** — הלחיצה מחזירה הודעה
 * שאומרת מה חוסם (DESIGN.md § מחיקה — כלל אחיד).
 */
export function TestMessageButton() {
  const action = useAction();
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          variant="secondary"
          disabled={action.busy}
          onClick={() => {
            setSentTo(null);
            action.run(() => sendWhatsappTestAction(), (data) => setSentTo(data.phone));
          }}
        >
          {he.whatsappAdmin.testSend}
        </Button>
      </div>
      {action.error ? <FormError>{action.error}</FormError> : null}
      {sentTo && !action.error ? <FormNotice>{he.whatsappAdmin.testSent(sentTo)}</FormNotice> : null}
    </div>
  );
}

/** "צור את תבנית הבדיקה" — מוצג רק כשהתבנית חסרה בחשבון */
export function CreateTemplatesButton() {
  const action = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          variant="secondary"
          size="compact"
          disabled={action.busy}
          onClick={() => action.run(() => createWhatsappTemplatesAction())}
        >
          {he.whatsappAdmin.createTestTemplate}
        </Button>
      </div>
      {action.error ? <FormError>{action.error}</FormError> : null}
    </div>
  );
}
