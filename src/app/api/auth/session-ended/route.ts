import { redirect } from "next/navigation";
import { activeSessionUser } from "@/lib/auth";
import { destroySession } from "@/lib/session";

/**
 * מסיים סשן שאינו תקף עוד ומחזיר למסך ההתחברות.
 *
 * קיים משום שמחיקת עוגייה חוקית ב-Next רק ב-Server Action או ב-Route Handler.
 * ‏`requireUser()` רץ בתוך רינדור של Server Component ולכן אינו יכול למחוק
 * בעצמו — הוא מפנה לכאן (`SESSION_ENDED_PATH`), וכאן המחיקה מותרת ונכנסת
 * לתוקף: ‏Next ממזג את העוגיות שהשתנו גם לתוך תשובת ההפניה.
 *
 * הנתיב אינו ב-matcher של `proxy.ts` (‏`/api` נשאר בחוץ), ולכן הוא נגיש גם
 * למי שסשנו כבר מת — אחרת ההפניה לכאן הייתה נחסמת בדרך.
 *
 * **מאמת מחדש לפני שהוא מוחק.** בלי הבדיקה הזו הנתיב היה הופך ל"יציאה
 * בקישור GET": קישור שנפתח בטעות היה מנתק משתמש תקף לחלוטין. מי שסשנו תקין
 * מוחזר פנימה בלי שנגעו בעוגייה שלו, והיציאה היזומה נשארת `logoutAction` —
 * ‏Server Action, שאינה ניתנת להפעלה מקישור.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (await activeSessionUser()) redirect("/board");

  await destroySession();
  redirect("/login");
}
