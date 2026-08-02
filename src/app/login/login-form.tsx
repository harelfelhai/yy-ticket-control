"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { he } from "@/lib/he";
import { type LoginState, loginAction } from "./actions";
import { FormError } from "@/components/ui/message";

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

      <Field label={he.login.identifierLabel}>
        <Input
          name="identifier"
          type="text"
          autoComplete="username"
          // ‏dir=ltr על השדה עצמו: מספר טלפון וכתובת מייל נקראים משמאל לימין
          // גם בממשק עברי, ובלי זה הסימנים בקצוות קופצים למקום הלא נכון.
          dir="ltr"
          required
        />
      </Field>

      <Field label={he.login.passwordLabel}>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
        />
      </Field>

      {state.error ? (
        <FormError>
          {state.error}
        </FormError>
      ) : null}

      <SubmitButton />
    </form>
  );
}
