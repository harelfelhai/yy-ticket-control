"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateThrottled } from "@/lib/auth";
import { he } from "@/lib/he";
import { safeNextPath } from "@/lib/safe-next";
import { createSession, destroySession } from "@/lib/session";

export interface LoginState {
  error?: string;
}

const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
  next: z.string().optional(),
});

/**
 * ‏Server Action ולא route handler ב-`/api/auth/login`: הטופס עובד גם בלי
 * JavaScript, אין צורך ב-fetch ובטיפול ידני בשגיאות רשת, ואין endpoint
 * ציבורי נוסף שצריך להגן עליו.
 */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
    // ‏FormData.get מחזיר null כששדה חסר, ו-`optional()` מקבל רק undefined.
    // בלי ההמרה הזו כל התחברות ללא פרמטר `next` נכשלה כאילו חסרים שדות.
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: he.login.missingFields };
  }

  const result = await authenticateThrottled(parsed.data.identifier, parsed.data.password);
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return { error: he.login.tooManyAttempts(Math.ceil(result.retryAfterSeconds / 60)) };
    }
    // הודעה אחת לכל סוגי הכישלון, כדי שלא ניתן יהיה למפות מי רשום במערכת.
    return { error: he.login.invalidCredentials };
  }

  await createSession(result.user);

  // מקבלים רק יעד יחסי. `next` מגיע מכתובת ה-URL, וקבלה של כתובת מלאה
  // הייתה הופכת את מסך ההתחברות למנוע הפניות לאתרים חיצוניים. הכלל עצמו
  // חי ב-`safe-next.ts` — ראה שם למה בדיקת תווים אינה מספיקה.
  redirect(safeNextPath(parsed.data.next));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
