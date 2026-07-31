import { redirect } from "next/navigation";
import { he } from "@/lib/he";
import { getSessionUser } from "@/lib/session";
import { LoginForm } from "./login-form";
import { TITLE_IDENTIFYING } from "@/lib/ui";

export const metadata = { title: `${he.login.title} — ${he.app.name}` };

export default async function LoginPage(props: PageProps<"/login">) {
  // ‏Next 16: searchParams הוא Promise.
  const { next } = await props.searchParams;

  // משתמש מחובר שמגיע לכאן (למשל דרך היסטוריית הדפדפן) לא צריך להתחבר שוב.
  if (await getSessionUser()) redirect("/board");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <h1 className={`mb-1 ${TITLE_IDENTIFYING}`}>{he.app.name}</h1>
        <p className="mb-6 text-sm text-muted">{he.login.title}</p>
        <LoginForm next={typeof next === "string" ? next : undefined} />
      </div>
    </main>
  );
}
