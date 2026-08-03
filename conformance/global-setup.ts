import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { E2E_ADMIN, truncateAll } from "../e2e/global-setup";

/**
 * הכנת הבסיס לחבילת ההתאמה: ריקון → מיגרציות → seed → **צוות ההתאמה**.
 *
 * שלושת הראשונים זהים ל-`e2e/global-setup.ts` ומיובאים ממנו (`truncateAll`)
 * כדי שלא יהיו שתי גרסאות לאותה פעולה. הרביעי הוא ההבדל: `provision-cast.ts`
 * מוסיף OWNER, שני מנהלי עבודה על אתר א׳, מנהל עבודה על אתר ב׳ ואתר שני מלא —
 * בלעדיהם §5.ז אינו ניתן לבדיקה דרך הדפדפן.
 *
 * החבילה משתמשת באותו בסיס `yy_e2e`, אך על **פורט אחר** (3102), כך ששרת
 * ההתאמה ושרת ה-E2E יכולים לחיות במקביל. שתי החבילות מרוקנות בעלייה, ולכן
 * הרצה סדרתית שלהן בטוחה; הרצה **במקביל** אינה.
 */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error("E2E_DATABASE_URL אינו מוגדר. הרץ `npm run db:up` והעתק את הערך ל-.env");
  }

  await truncateAll(url);

  const require = createRequire(path.join(process.cwd(), "package.json"));
  const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_PASSWORD: E2E_ADMIN.password };

  const steps: [string, string[]][] = [
    [require.resolve("prisma/build/index.js"), ["migrate", "deploy"]],
    [require.resolve("tsx/cli"), ["prisma/seed.ts"]],
    [require.resolve("tsx/cli"), ["conformance/provision-cast.ts"]],
  ];

  for (const [script, args] of steps) {
    const result = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `הכנת בסיס ההתאמה נכשלה (${args.join(" ")}):\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}
