import { env } from "@/lib/env";
import { gmailSource } from "./gmail-source";
import type { MailSource } from "./source";

/**
 * בוחר את מקור הקריאה לפי הסביבה — ו**אין כאן נפילה חיננית**.
 *
 * זה השוני מ-`selectEmailTransport` ומ-`selectTranscriber`, ששניהם נופלים
 * בפיתוח למימוש מדומה: לשליחה ולתמלול יש תחליף שאפשר לראות (לוג, דילוג),
 * ולקריאה מתיבה אין. תיבה מדומה שמחזירה רשימה ריקה הייתה נראית **בדיוק**
 * כמו ערוץ תקין שאין בו דואר חדש — כלומר הכשל השקט המושלם. לכן חוסר הגדרה
 * הוא חריגה בכל סביבה, והבדיקות מזריקות תיבה משלהן (`fakeMailSource`).
 *
 * נקודת קריאה משותפת ולא שתיים: הסבב (`services/email-poll.ts`) והמטפל
 * בג׳וב הקליטה (`jobs/handlers/email.ts`) הגדירו את זה בעבר כל אחד לעצמו,
 * בשתי נוסחאות שגיאה שונות לאותה תקלה בדיוק. `email-reply.ts` **אינו**
 * קורא לכאן: שם היעדר תצורה הוא ויתור שקט על בדיקת האידמפוטנטיות
 * (`defaultMailSource`), לא כשל — ראו התיעוד שם.
 */
export function selectMailSource(): MailSource {
  const config = env.gmailApi();
  if (!config) {
    throw new Error(
      "קריאת התיבה אינה מוגדרת: נדרשים GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ו-GMAIL_REFRESH_TOKEN. ראה .env.example",
    );
  }
  return gmailSource(config);
}
