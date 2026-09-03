"use server";

import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { changeOwnPassword } from "@/lib/services/account";

/**
 * הפעולות של מסך החשבון האישי.
 *
 * `requireUser()` ולא מזהה מהלקוח: הפעולה חלה על **המשתמש המחובר בלבד**,
 * ואין בה פרמטר שמזהה מישהו אחר. זו ההפרדה מ-`admin/actions.ts`, שם מנהל
 * פועל על אחרים ולכן המזהה כן מגיע מהלקוח ונבדק מולו.
 */

const changePasswordSchema = z.object({
  // `min(1)` בלבד: מדיניות האורך חלה על החדשה ונאכפת בשירות, ואילו הנוכחית
  // נבדקת מול הגיבוב. סף אורך כאן היה מסגיר את המדיניות שהייתה בתוקף כשהיא
  // נקבעה, ודוחה משתמש ותיק עם סיסמה קצרה עוד לפני שנבדק אם היא נכונה.
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function changePasswordAction(
  input: z.infer<typeof changePasswordSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    const parsed = changePasswordSchema.parse(input);
    await changeOwnPassword(await requireUser(), parsed.currentPassword, parsed.newPassword);
  });
}
