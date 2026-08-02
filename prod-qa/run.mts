import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * מנהל ריצת QA מול הפרודקשן: מקים משתמש זמני, מריץ את המעבר, ומנקה.
 *
 * **הסיסמה אינה יוצאת מהתהליך הזה.** היא נוצרת כאן ב-`randomBytes`, עוברת
 * ל-Playwright דרך משתנה סביבה של תת-התהליך בלבד, ונמחקת עם המשתמש בסוף.
 * היא אינה נכתבת לדיסק, אינה מודפסת, ואינה נלקחת מהסביבה המקומית — זה
 * בדיוק הכשל שתועד בפריסה הראשונה, שבו `.env` מקומי דלף ל-DB של פרודקשן.
 *
 * **המשתמש הקיים אינו נוגע.** הסקריפט אינו מאפס סיסמאות ואינו מריץ seed.
 */

/**
 * **שער מכוון.** הסקריפט הזה **כותב לפרודקשן** — הוא יוצר פניות, תגיות
 * ואנשי מקצוע אמיתיים ומוחק אותם בסוף. כל עוד המערכת לפני עלייה לאוויר זה
 * חסר משמעות; מרגע שמנהלי עבודה עובדים בה, פנייה שצצה ונעלמת נראית להם.
 *
 * הניקוי ממוקד בשם ולא נוגע בנתונים קיימים, אבל **היצירה גלויה** — ולכן
 * ההרצה דורשת אישור מפורש ולא נשארת פקודה שקל להריץ בהיסח הדעת.
 */
if (process.env.QA_CONFIRM !== "1") {
  console.error(
    "הסקריפט כותב לפרודקשן (יוצר ומוחק פניות אמיתיות).\n" +
      "להרצה מודעת: QA_CONFIRM=1 npx tsx prod-qa/run.mts",
  );
  process.exit(2);
}

const RUN = `qa${Date.now().toString(36)}`;
const PHONE = `059${String(Date.now()).slice(-7)}`;
const PASSWORD = `Q${randomBytes(18).toString("base64url")}!9`;

/** נקרא לתוך התהליך בלבד — הערך אינו מודפס לעולם */
function productionDatabaseUrl(): string {
  // ‏`shell: true` ב-Windows: `railway` הוא shim מסוג `.cmd` ש-`spawnSync`
  // אינו מוצא בלי מעטפת.
  const raw = execFileSync("railway", ["variables", "--service", "Postgres", "--kv"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("DATABASE_PUBLIC_URL="));
  if (!line) throw new Error("‏DATABASE_PUBLIC_URL לא נמצא בשירות Postgres");
  return line.slice("DATABASE_PUBLIC_URL=".length).trim();
}

const url = productionDatabaseUrl();
process.env.DATABASE_URL = url;

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../src/generated/prisma/client.js");
const { hashPassword } = await import("../src/lib/auth.js");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

console.log(`ריצת QA ${RUN} מול הפרודקשן\n`);

const before = {
  users: await db.user.count(),
  tickets: await db.ticket.count(),
  professionals: await db.professional.count(),
  tags: await db.tag.count(),
  domains: await db.domain.count(),
  messages: await db.message.count(),
  media: await db.mediaFile.count(),
};
console.log("לפני:", JSON.stringify(before));

const qaUser = await db.user.create({
  data: {
    name: `QA ${RUN}`,
    phone: PHONE,
    role: "ADMIN",
    active: true,
    passwordHash: await hashPassword(PASSWORD),
  },
});
console.log(`נוצר משתמש זמני ${qaUser.name}\n`);

let failed = false;
try {
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "-c",
      "prod-qa/playwright.config.ts",
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, QA_RUN: RUN, QA_PHONE: PHONE, QA_PASSWORD: PASSWORD },
    },
  );
  failed = result.status !== 0;
  if (result.error) console.error(result.error);
} finally {
  console.log("\n── ניקוי ─────────────────────────────────────────────");

  /**
   * סדר המחיקה נגזר מהסכימה: `Ticket` ו-`Tag` מוחקים בשרשור את ההודעות,
   * השיוכים והמדיה שתלויים בהם; רק אחריהם אפשר למחוק אנשי מקצוע
   * (‏`Assignment.professional` הוא `Restrict`), ורק בסוף את המשתמש.
   */
  const like = { contains: RUN };

  const tickets = await db.ticket.deleteMany({ where: { description: like } });
  const tags = await db.tag.deleteMany({ where: { name: like } });
  // טיוטות ההזנה המרוכזת נושאות את התיאור, אך גם התגית המשותפת נוצרה
  const batchTags = await db.tag.deleteMany({ where: { name: { contains: `סבב ${RUN}` } } });
  const orphanMedia = await db.mediaFile.deleteMany({ where: { uploaderUserId: qaUser.id } });
  const pros = await db.professional.deleteMany({ where: { name: like } });
  const domains = await db.domain.deleteMany({ where: { name: like } });
  const users = await db.user.deleteMany({ where: { name: like } });

  console.log(
    `נמחקו: ${tickets.count} פניות · ${tags.count + batchTags.count} תגיות · ` +
      `${pros.count} אנשי מקצוע · ${domains.count} תחומים · ${users.count} משתמשים · ` +
      `${orphanMedia.count} קובצי מדיה יתומים`,
  );

  const after = {
    users: await db.user.count(),
    tickets: await db.ticket.count(),
    professionals: await db.professional.count(),
    tags: await db.tag.count(),
    domains: await db.domain.count(),
    messages: await db.message.count(),
    media: await db.mediaFile.count(),
  };
  console.log("אחרי:", JSON.stringify(after));

  const drift = Object.entries(after)
    .filter(([key, value]) => value !== before[key as keyof typeof before])
    .map(([key, value]) => `${key}: ${before[key as keyof typeof before]} → ${value}`);

  if (drift.length > 0) console.log(`\n⚠ שאריות: ${drift.join(", ")}`);
  else console.log("\nהבסיס חזר בדיוק למצבו לפני הריצה.");

  await db.$disconnect();
}

process.exit(failed ? 1 : 0);
