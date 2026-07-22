import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export const E2E_ADMIN = {
  phone: "0500000000",
  password: "dev-admin-1234",
  name: "מנהל ראשי",
};

/**
 * מכין את בסיס הבדיקות לפני ריצת ה-E2E: מיגרציות ואז seed.
 *
 * ה-seed הוא idempotent, ולכן הרצה חוזרת אינה משכפלת ואינה משנה את סיסמת
 * המנהל הקיים. הסיסמה נקבעת דרך SEED_ADMIN_PASSWORD כי בדיקה חייבת פרטי
 * התחברות ידועים מראש; בפרודקשן המשתנה נשאר ריק ונוצרת סיסמה אקראית.
 */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL אינו מוגדר. הרץ `npm run db:up` והעתק את הערך ל-.env");
  }

  // ‏Playwright מריץ את הקובץ כ-CommonJS, ולכן `import.meta.url` אינו זמין.
  // עוגן יחסי לשורש הפרויקט משיג את אותה תוצאה בלי תלות בפורמט המודול.
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_PASSWORD: E2E_ADMIN.password };

  const steps: [string, string[]][] = [
    [require.resolve("prisma/build/index.js"), ["migrate", "deploy"]],
    [require.resolve("tsx/cli"), ["prisma/seed.ts"]],
  ];

  for (const [script, args] of steps) {
    const result = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `הכנת בסיס הבדיקות נכשלה (${args.join(" ")}):\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}
