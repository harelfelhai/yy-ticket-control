import { NextResponse } from "next/server";

/**
 * נקודת בריאות ל-healthcheck של הפלטפורמה (Railway) ולניטור חיצוני.
 *
 * **מכוון שאינה נוגעת ב-DB.** היא מאשרת שהשרת עלה ומגיב — לא שהתלויות שלו
 * זמינות. בדיקת בריאות שמנסה להתחבר ל-DB הופכת תקלת רשת חולפת אל בסיס
 * הנתונים להפלה של השירות כולו, כולל מסכים שאינם תלויים בו כרגע.
 *
 * הנתיב ציבורי: `proxy.ts` אינו כולל `/api` ב-matcher (ה-API מאמת בעצמו),
 * ולכן בדיקת הבריאות אינה נחסמת בהפניה למסך ההתחברות.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
