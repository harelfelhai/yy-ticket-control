import { redirect } from "next/navigation";
import { parseGoogleLoginError } from "@/lib/google-oauth";
import { he } from "@/lib/he";
import { getSessionUser } from "@/lib/session";
import { isGoogleLoginConfigured } from "@/lib/services/google-login";
import { GoogleSignIn } from "./google-button";
import { LoginForm } from "./login-form";
import { PANEL_WIDTH, TITLE_IDENTIFYING } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { FormError } from "@/components/ui/message";

export const metadata = { title: `${he.login.title} — ${he.app.name}` };

export default async function LoginPage(props: PageProps<"/login">) {
  // ‏Next 16: searchParams הוא Promise.
  const { next, error } = await props.searchParams;

  // משתמש מחובר שמגיע לכאן (למשל דרך היסטוריית הדפדפן) לא צריך להתחבר שוב.
  if (await getSessionUser()) redirect("/board");

  // מסלול גוגל חוזר לכאן עם קוד ולא עם נוסח: הנוסח חי ב-`he.ts`, והקוד הוא
  // מה שמותר לו לנסוע בכתובת. כל ערך שאינו קוד מוכר מסתנן ל-null.
  const googleError = parseGoogleLoginError(error);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className={cardClasses(PANEL_WIDTH, { padding: "roomy" })}>
        <h1 className={`mb-1 ${TITLE_IDENTIFYING}`}>{he.app.name}</h1>
        <p className="mb-6 text-sm text-muted">{he.login.title}</p>

        {/*
         * **מחוץ ל-`<form>`, וזה נושא-משקל.** `e2e/auth.spec.ts` מאתר את
         * שגיאת הסיסמה ב-`page.locator("form").getByRole("alert")`. שני
         * אזורי `alert` בתוך אותו טופס היו הופכים את הבורר לשגיאת
         * strict-mode ברגע ששניהם מוצגים.
         *
         * ‏`FormError` ולא באנר: ל-`Banner` אין טון `danger`, ו-`FormError`
         * נכון גם סמנטית — המשתמש לחץ וממתין לתוצאה, גם אם היא חזרה
         * דרך גוגל.
         */}
        {googleError ? (
          <FormError className="mb-4">{he.login.googleErrors[googleError]}</FormError>
        ) : null}

        <LoginForm next={typeof next === "string" ? next : undefined} />

        {isGoogleLoginConfigured() ? (
          <GoogleSignIn next={typeof next === "string" ? next : undefined} />
        ) : null}
      </div>
    </main>
  );
}
