"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { he } from "@/lib/he";
import { type LoginState, loginAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full transition-opacity">
      {pending ? he.login.submitting : he.login.submit}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <Input type="hidden" name="next" value={next} /> : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{he.login.identifierLabel}</span>
        <Input
          name="identifier"
          type="text"
          autoComplete="username"
          // ‏dir=ltr על השדה עצמו: מספר טלפון וכתובת מייל נקראים משמאל לימין
          // גם בממשק עברי, ובלי זה הסימנים בקצוות קופצים למקום הלא נכון.
          dir="ltr"
          required
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{he.login.passwordLabel}</span>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
