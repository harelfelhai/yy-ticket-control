"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError, FormNotice } from "@/components/ui/message";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { changePasswordAction } from "./actions";

/**
 * טופס החלפת הסיסמה.
 *
 * **שדה האימות נבדק כאן ולא בשרת, וזו החלטה ולא קיצור דרך.** "שתי הסיסמאות
 * אינן זהות" אינו כלל עסקי אלא הגנה מפני שגיאת הקלדה בטופס הזה: השרת מקבל
 * סיסמה אחת, ואין לו מושג שהמשתמש הקליד אותה פעמיים. שליחת שני השדות רק
 * כדי שהשרת ישווה ביניהם הייתה מעבירה סוד נוסף על החוט בלי שום תמורה.
 */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();

  function submit() {
    setDone(false);
    if (next !== confirm) {
      setError(he.account.confirmMismatch);
      return;
    }

    run(() => changePasswordAction({ currentPassword: current, newPassword: next }), () => {
      // השדות מתרוקנים בהצלחה: סיסמה שנשארת מוצגת בטופס אחרי שהוחלפה היא
      // בדיוק מה שהמשתמש בא לסלק מהמסך.
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{he.account.changePasswordHint}</p>

      <Field label={he.account.currentPassword}>
        <Input
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          disabled={busy}
        />
      </Field>

      <Field label={he.account.newPassword}>
        <Input
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={busy}
        />
      </Field>

      <Field label={he.account.confirmPassword}>
        <Input
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />
      </Field>

      {error ? <FormError>{error}</FormError> : null}
      {done ? <FormNotice>{he.account.changed}</FormNotice> : null}

      <Button onClick={submit} disabled={busy || !current || !next || !confirm}>
        {he.account.submit}
      </Button>
    </div>
  );
}
