import { UserFacingError } from "@/lib/action-result";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import type { SessionUser } from "@/lib/session";

/**
 * החשבון של המשתמש עצמו — להבדיל מ-`admin.ts`, שהוא פעולות של מנהל על אחרים.
 *
 * **הפער שזה סוגר (הכרעת מימוש 1.1).** עד כאן `passwordHash` נכתב בשני
 * מקומות בלבד: הקמת משתמש בידי מנהל, וה-seed. לא היה שום מסלול לשנות
 * סיסמה — לא למשתמש ולא למנהל. כלומר התווית "סיסמה ראשונית" במסך ההקמה
 * תיארה משהו שאינו קיים: הסיסמה שהמנהל הקליד הייתה **הסיסמה הצמיתה** של
 * המשתמש, וכל מי שנכח בהקמה ידע אותה לתמיד.
 *
 * **מה זה מכוון לפתור, ומה לא.** ההחלפה העצמית הופכת את הסיסמה הראשונית
 * למה ששמה מבטיח — נקודת התחלה. היא אינה מנגנון שחזור: מי ששכח את סיסמתו
 * אינו יכול להחליף אותה, כי הוא נדרש לה. השחזור הוא `resetUserPassword`
 * בידי מנהל (`admin.ts`), וזו הסיבה ששתי הפונקציות נוספו יחד.
 *
 * **מה שהחלפת סיסמה כאן אינה עושה: היא אינה מנתקת סשנים אחרים.** הסשן הוא
 * עוגיית `iron-session` חתומה ומוצפנת שמכילה את פרטי המשתמש (ראו
 * `session.ts`), ואין טבלת סשנים לבטל מולה. לכן דפדפן אחר שכבר מחובר
 * ימשיך לעבוד עד תפוגת העוגייה, גם אחרי שהסיסמה הוחלפה. במקרה השכיח —
 * "המנהל נתן לי סיסמה, אני רוצה משלי" — זה חסר משמעות; במקרה של סיסמה
 * שדלפה זו הגנה חלקית בלבד. הסגירה המלאה דורשת חותמת `passwordChangedAt`
 * על `User` שנבדקת ב-`requireUser`, והיא לא נעשתה כאן במכוון: היא מיגרציה
 * ושינוי צורת ה-`SessionUser`, ולא חלק מהפער שדווח.
 */

export class AccountError extends UserFacingError {}

/**
 * מוודא שסיסמה חדשה עומדת במדיניות. משותף להחלפה עצמית ולאיפוס בידי מנהל,
 * כדי ששני המסלולים לא ייפרדו — זה בדיוק מה שקרה למדיניות עצמה עד 1.1.
 */
export function assertPasswordAllowed(password: string, error: (message: string) => Error): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw error(he.admin.passwordTooShort(MIN_PASSWORD_LENGTH));
  }
}

/**
 * מחליף את הסיסמה של המשתמש המחובר.
 *
 * **הסיסמה הנוכחית נדרשת, ואינה פורמליות.** הסשן לבדו אינו מספיק: מחשב
 * שנשאר פתוח הוא הדרך הריאלית שבה חשבון פנימי נחטף, ובלי הדרישה הזו כל מי
 * שמתיישב מולו יכול לנעול את הבעלים בחוץ בשתי לחיצות.
 *
 * המשתמש נטען מחדש מה-DB ולא נלקח מהסשן: הסשן מחזיק שם, תפקיד ואתר — לא
 * גיבוב — וממילא הוא עלול להיות ישן (ראו `session.ts`).
 */
export async function changeOwnPassword(
  actor: SessionUser,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: actor.id },
    select: { id: true, passwordHash: true },
  });
  // סשן תקף למשתמש שנמחק מאז. `requireUser` תופס את זה במסך, אבל Server
  // Action היא נקודת כניסה בפני עצמה ואינה מסתמכת על מה שקרה במסך.
  if (!user) throw new AccountError(he.account.userGone);

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AccountError(he.account.currentPasswordWrong);
  }

  assertPasswordAllowed(newPassword, (message) => new AccountError(message));

  // סיסמה זהה לקודמת אינה שגיאת אבטחה, אבל היא כמעט תמיד טעות: המשתמש
  // חשב שהוא מחליף וקיבל אישור על כלום. עדיף לומר לו.
  if (await verifyPassword(user.passwordHash, newPassword)) {
    throw new AccountError(he.account.samePassword);
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}
