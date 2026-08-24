import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewOverview } from "@/lib/permissions";
import { toViewer } from "@/lib/session";

/**
 * שער האזור — **צפייה**, לא ניהול.
 *
 * ‏`/admin` חדל להיות "מסכי הניהול" והפך למסך אחד שיש בו שתי שכבות: סקירת
 * האתרים בראשו, וכפתורי הניהול מתחתיה. השתיים שייכות לשני קהלים שונים —
 * הבעלים רואה את הסקירה ואינו מנהל דבר — ולכן שער אחד ל-ADMIN בלבד היה
 * נועל את הבעלים מחוץ למסך שנבנה בשבילו.
 *
 * **החלוקה:** השער כאן מרחיק את מנהל העבודה בלבד (אין לו תצוגה חוצת-אתרים,
 * אפיון §5.ז), ומסכי הניהול עצמם יושבים תחת `(manage)` עם שער משלהם. קבוצת
 * נתיב ולא תיקייה בכתובת: הכתובות `/admin/users` ושכנותיה נשארות כשהיו.
 *
 * זו הגנת התצוגה בלבד; כל Server Action מאמת מחדש בשירות, כי היא נקודת
 * כניסה ציבורית בפני עצמה.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!canViewOverview(toViewer(user))) redirect("/board");
  return <>{children}</>;
}
