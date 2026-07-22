import { he } from "@/lib/he";

/**
 * דף שער זמני (M0).
 * ב-M0.6, כשמסך ההתחברות והלוח קיימים, הדף הזה יוחלף בהפניה:
 * משתמש מחובר → `/board`, אחרת → `/login`.
 */
export default function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold">{he.app.name}</h1>
        <p className="mt-2 text-muted">{he.app.description}</p>
        <p className="mt-6 text-sm text-muted">
          המערכת בהקמה. מסך ההתחברות יעלה בשלב הבא.
        </p>
      </div>
    </main>
  );
}
