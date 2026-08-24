import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAdmin } from "@/lib/permissions";
import { toViewer } from "@/lib/session";

/**
 * ההגנה על מסכי הניהול עצמם — אתרים, משתמשים, אנשי מקצוע ותחומים.
 *
 * **למה שער שני ולא תנאי בשער שמעליו.** ‏layout ב-Next עוטף גם את העמוד
 * שלו, ולכן שער ADMIN על `/admin` היה חוסם את הבעלים מסקירת האתרים שיושבת
 * שם עכשיו. קבוצת הנתיב `(manage)` מייצרת בדיוק את הגבול שנדרש: הכתובות
 * אינן משתנות, ומסך ניהול חדש שייכתב כאן מוגן אוטומטית — אי אפשר לשכוח.
 *
 * ‏`canManageAdmin` ולא `role === "ADMIN"` כתוב ידנית: זהו אותו פרדיקט
 * שהשירותים אוכפים (`assertAdmin` ב-`services/admin.ts`), ושכפולו כאן היה
 * מזמין את שתי הבדיקות להיפרד.
 */
export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!canManageAdmin(toViewer(user))) redirect("/board");
  return <>{children}</>;
}
