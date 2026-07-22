import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * מריץ פעם אחת לפני כל בדיקות האינטגרציה: מביא את בסיס הבדיקות למצב
 * הסכימה העדכני. `migrate deploy` (ולא `migrate dev`) כי כאן לא מייצרים
 * מיגרציות אלא רק מחילים קיימות — וכך הבדיקות רצות בדיוק מול מה שיגיע
 * לפרודקשן.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL אינו מוגדר. הרץ `npm run db:up` והעתק את הערך ל-.env",
    );
  }

  // מריצים את ה-CLI ישירות דרך node ולא דרך `npx` עם shell: מנוע ה-shell
  // מדביק ארגומנטים בלי escaping, ו-npx מוסיף שכבת פתרון מיותרת.
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");

  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `הכנת בסיס הבדיקות נכשלה:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}
