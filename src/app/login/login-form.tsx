"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { he } from "@/lib/he";
import { type LoginState, loginAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      // ‏min-h-12: אזור מגע נדיב, כי המשתמש העיקרי מקליד בשטח ולעיתים בכפפות.
      className="min-h-12 w-full rounded-xl bg-brand px-4 text-base font-semibold text-brand-fg transition-opacity disabled:opacity-60"
    >
      {pending ? he.login.submitting : he.login.submit}
    </button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{he.login.identifierLabel}</span>
        <input
          name="identifier"
          type="text"
          autoComplete="username"
          // ‏dir=ltr על השדה עצמו: מספר טלפון וכתובת מייל נקראים משמאל לימין
          // גם בממשק עברי, ובלי זה הסימנים בקצוות קופצים למקום הלא נכון.
          dir="ltr"
          required
          className="min-h-12 rounded-xl border border-border bg-surface px-3 text-base"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{he.login.passwordLabel}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          className="min-h-12 rounded-xl border border-border bg-surface px-3 text-base"
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
