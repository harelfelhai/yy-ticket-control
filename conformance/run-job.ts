import "dotenv/config";

/**
 * מפעיל ג׳וב אמיתי של המערכת מתוך בדיקה.
 *
 * **למה תהליך נפרד:** ‏`src/lib/db.ts` קורא את `DATABASE_URL` בזמן הייבוא,
 * ובתהליך ה-Playwright המשתנה מצביע על בסיס הפיתוח. הרצה כאן, עם
 * `DATABASE_URL` שנקבע מראש בסביבת התהליך, מבטיחה שהג׳וב פועל על בסיס
 * הבדיקות.
 *
 * **למה בכלל:** הג׳וב היומי מתוזמן ל-06:00 מחר ולא ירוץ בתוך הבדיקה. הדרך
 * היחידה לאמת את §5.ג ("ללא תנועה 7 ימים") היא להזיז את `lastActivityAt`
 * אחורה ואז להפעיל את הג׳וב **האמיתי** — לא לשכפל את הלוגיקה שלו בבדיקה,
 * מה שהיה בודק את הבדיקה במקום את המוצר.
 *
 * שימוש: `tsx conformance/run-job.ts escalate [ISO]`
 */
async function main() {
  const [command, iso] = process.argv.slice(2);
  const now = iso ? new Date(iso) : new Date();

  switch (command) {
    case "escalate": {
      const { runDailyEscalation } = await import("../src/jobs/handlers/escalation");
      const count = await runDailyEscalation(now);
      console.log(`escalated=${count}`);
      break;
    }
    case "drain": {
      const { drainJobs } = await import("../src/jobs/worker");
      const processed = await drainJobs({}, now);
      console.log(`drained=${processed}`);
      break;
    }
    default:
      throw new Error(`פקודה לא מוכרת: ${command}`);
  }

  const { db } = await import("../src/lib/db");
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
