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
