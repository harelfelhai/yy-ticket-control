import { type Page, expect, test } from "@playwright/test";
import { addProfessional, loginAsManager, makeMinimalDraft, pick } from "./helpers";

/**
 * מצב השלמת הטיוטה שורד רענון דף (אפיון §2.5, מסך 7).
 *
 * מה שמנהל העבודה מקליד במסך ההשלמה — תחום, תיאור, נמען שנוצר תוך כדי — חי
 * רק בזיכרון של רכיב הלקוח. רענון (משיכה-לרענון או קריסה במובייל, ניווט
 * בטעות) מוחק אותו. התיקון שומר את המצב ב-IndexedDB ומשחזר אותו בעלייה,
 * בדיוק כמו טופס היצירה (`offline-draft`). המבחן נכשל על הקוד לפני התיקון
 * (המצב נמחק) ועובר אחריו (המצב חוזר).
 *
 * ‏**בלי** ה-addInitScript שמנקה IndexedDB בכל ניווט (כמו ב-draft.spec):
 * הוא היה מוחק את מה שנשמר עוד לפני שהרענון טוען את האפליקציה, ומרוקן את
 * עצם הדבר שהמבחן בודק. כל בדיקה מקבלת context נקי, ולכן אין צורך בניקוי.
 */

/** קורא את ה-snapshot השמור של השלמת הטיוטה ישירות מ-IndexedDB של הדפדפן */
function completionSnapshot(page: Page, ticketId: string) {
  return page.evaluate((id) => {
    return new Promise<{ domainId: string | null; recipientIds: unknown[] } | null>((resolve) => {
      const request = indexedDB.open("yy-ticket-control", 1);
      request.onsuccess = () => {
        try {
          const tx = request.result.transaction("drafts", "readonly");
          const get = tx.objectStore("drafts").get(`complete:${id}`);
          get.onsuccess = () => resolve((get.result as never) ?? null);
          get.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  }, ticketId);
}

test("מצב ההשלמה שורד רענון דף: תחום, תיאור ונמען שנבחרו חוזרים, והשיגור מצליח", async ({
  page,
}) => {
  const stamp = Date.now();
  const electrician = `חשמלאי ${stamp}`;
  const descriptionText = `אין חשמל בסלון ${stamp}`;

  await loginAsManager(page);
  const draftPath = await makeMinimalDraft(page);
  const ticketId = draftPath.split("/").pop() ?? "";

  // ממלאים את החסר — אבל עדיין לא משגרים. כל אלה חיים רק בזיכרון עד שיישמרו.
  // טלפון ייחודי לפי ה-stamp: הבסיס משותף לכל בדיקות ה-E2E, ו-
  // findOrCreateProfessional ממזג לפי טלפון — מספר קבוע היה מחזיר איש-מקצוע
  // של בדיקה אחרת (בשם אחר) ושובר את הבדיקה.
  await pick(page, "תחום", "חשמל");
  await page.getByLabel("תיאור").fill(descriptionText);
  await addProfessional(page, electrician, `050${String(stamp).slice(-7)}`);

  // ממתינים דטרמיניסטית עד שהשמירה המושהית (400ms) נחתה ותפסה את שניהם —
  // אחרת רענון מוקדם מדי היה בודק מצב שטרם נשמר.
  await expect
    .poll(
      async () => {
        const snap = await completionSnapshot(page, ticketId);
        return Boolean(snap?.domainId) && (snap?.recipientIds.length ?? 0) > 0;
      },
      { timeout: 5_000 },
    )
    .toBe(true);

  // הרס מופע הרכיב החי. לפני התיקון: הכול נמחק. אחרי: נשמר ב-IndexedDB.
  await page.reload();

  // הנמען שנוצר תוך כדי חזר לבורר — זהו בדיוק מה שהיה נמחק ("נעלם מהרשימה").
  await expect(page.getByRole("list", { name: "נמענים", exact: true })).toContainText(electrician);
  // התיאור שהוקלד חזר לשדה.
  await expect(page.getByLabel("תיאור")).toHaveValue(descriptionText);

  // ההוכחה שהשחזור אמיתי ולא רק ויזואלי: השיגור מצליח. הוא דורש גם תחום —
  // כך שהצלחתו מוכיחה שגם התחום שוחזר, לא רק מה שנראה על המסך.
  await page.getByRole("button", { name: "שגר", exact: true }).click();

  await expect(page.getByText("טיוטה — חסרים פרטים. לא נשלחה לאיש.")).toHaveCount(0);
  const recipients = page.getByRole("list", { name: "נמענים", exact: true });
  await expect(recipients).toContainText(electrician);
  await expect(recipients).toContainText("נשלח");
});
