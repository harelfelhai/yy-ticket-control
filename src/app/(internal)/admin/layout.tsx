import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

/**
 * ההגנה על כל מסכי הניהול, במקום אחד.
 *
 * מסך ניהול חדש שנוסיף תחת התיקייה הזו מוגן אוטומטית — אי אפשר לשכוח.
 * זו הגנת התצוגה בלבד; כל Server Action מאמת מחדש בשירות, כי היא נקודת
 * כניסה ציבורית בפני עצמה.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/board");
  return <>{children}</>;
}
