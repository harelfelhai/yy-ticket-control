import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * הקבועים של מסך 17 ב-E2E, ומריץ הזריעה (`seed-whatsapp.ts`). קובץ נפרד ולא
 * ה-spec עצמו: הזריעה רצה כתהליך tsx ומייבאת מכאן את אותם קבועים.
 */

/** המספר הזרוע — מזהה שאינו של אף מספר אמיתי */
export const WA_PHONE_NUMBER_ID = "300000000000077";

/** בעלים, להוכחה שהמסך שמור למנהל המערכת בלבד */
export const WA_OWNER = { phone: "0500000077", password: "e2e-owner-1234", name: "בעלים לבדיקה" };

export function seedWhatsapp(scenario: "connected" | "error" | "clear"): void {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join("e2e", "seed-whatsapp.ts"), scenario], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`זריעת מסך 17 נכשלה (${scenario}):\n${result.stdout}\n${result.stderr}`);
  }
}

// ─────────────────────── טיוטה מוואטסאפ במסך 7 (W8) ───────────────────────

/**
 * המספר של זריעת הטיוטה — **מספר משלה**, ולא זה של מסך 17: הזריעה של מסך 17 מוחקת
 * את המספר שלה ואת כל ההודעות שלו (`clear`), והשיחה של הטיוטה הייתה נמחקת איתו.
 * מחובר, ומוקדם מזה של מסך 17 — כדי שמסך 17 והבאנר בלוח יקראו את המספר שלהם.
 */
export const WA_DRAFT_NUMBER_ID = "300000000000088";

export const WA_REPORT = "תקלה: נזילה מהדוד על הגג, המים יורדים לחדר המדרגות";
export const WA_TRANSCRIPT = "הדוד דולף כבר מהבוקר, צריך אינסטלטור";
export const WA_ACK = "שלום, ההודעה שלך נשמרה כטיוטה במערכת בקרת פניות. הטיוטה עוד לא נשלחה לאיש.";
export const WA_REPLY = "זה בבניין ב, לא בבניין א";
export const WA_REPLY_ACK = "עודכן מהתגובה שלך: בניין. סותר את מה שנקבע במערכת: ההכרעה תיעשה במערכת.";
export const WA_DISPATCHED_REPORT = "תקלה בלוח החשמל בכניסה לבניין";
export const WA_DISPATCHED_ACK = "כל הפרטים זוהו. כדי לשלוח את הפנייה לנמענים: (קישור)";
export const WA_LATE_ACK = "הפנייה כבר נשלחה לנמענים, ולכן התגובה הזו לא שינתה בה דבר.";

export interface WaDraftSeed {
  draftId: string;
  dispatchedId: string;
}

/** זורע טיוטה מוואטסאפ עם שיחה, ופנייה מוואטסאפ ששוגרה (`seed-whatsapp-draft.ts`) */
export function seedWhatsappDraft(): WaDraftSeed {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join("e2e", "seed-whatsapp-draft.ts")], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`זריעת הטיוטה מוואטסאפ נכשלה:\n${result.stdout}\n${result.stderr}`);
  }
  const draftId = /DRAFT_ID=(\S+)/.exec(result.stdout)?.[1];
  const dispatchedId = /DISPATCHED_ID=(\S+)/.exec(result.stdout)?.[1];
  if (!draftId || !dispatchedId) throw new Error(`הזריעה לא הדפיסה מזהים:\n${result.stdout}`);
  return { draftId, dispatchedId };
}
