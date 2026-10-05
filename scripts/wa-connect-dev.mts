/**
 * מחבר את **מספר הבדיקה** של Meta לבסיס הפיתוח — `WaNumber` אחד, עם הטוקן
 * מוצפן. בפרודקשן החיבור נעשה ממסך 17 (W5); כאן הוא קיצור לפיתוח בלבד.
 *
 * שימוש:
 *   npx tsx scripts/wa-connect-dev.mts --waba <WABA id>
 *
 * קורא מ-`.env.local`: `WHATSAPP_DEV_PHONE_NUMBER_ID`, `WHATSAPP_DEV_ACCESS_TOKEN`,
 * `SESSION_SECRET` ו-`DATABASE_URL`. **הטוקן אינו מודפס לעולם** — הוא נשלח
 * ל-Graph בכותרת בלבד ונשמר מוצפן (`sealWaToken`).
 *
 * **רק מול בסיס מקומי.** כתובת בסיס שאינה localhost נדחית: הסקריפט כותב שורת
 * חיבור, ובפרודקשן שורה כזו פירושה שהמערכת מתחילה לקלוט מהמספר.
 *
 * `activatedAt` נקבע **בכל חיבור, גם חוזר** — אותו כלל של מסך 17 (§5.ה5 כלל 5,
 * §7 שורה 103): הודעה מלפני החיבור אינה נקלטת, גם כשוואטסאפ מוסרת אותה באיחור.
 *
 * בשונה מחיבור ממסך 17, התסריט **אינו** נרשם ל-WABA עם עקיפת כתובת: מספר הבדיקה
 * של Meta מקבל את ההודעות בכתובת ה-callback של האפליקציה (ה-Dashboard), שבפיתוח
 * מצביעה על המנהרה (`docs/whatsapp-setup.md`).
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const { db } = await import("../src/lib/db");
const { WaApiError } = await import("../src/lib/whatsapp/errors");
const { graphJson } = await import("../src/lib/whatsapp/graph");
const { sealWaToken } = await import("../src/lib/whatsapp/token");

/** כשל שמוסבר למשתמש — בלי stack trace */
class UsageError extends Error {}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wabaIndex = args.indexOf("--waba");
  const wabaId = wabaIndex >= 0 ? args[wabaIndex + 1] : process.env.WHATSAPP_DEV_WABA_ID;
  const phoneNumberId = process.env.WHATSAPP_DEV_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_DEV_ACCESS_TOKEN;
  const databaseUrl = process.env.DATABASE_URL ?? "";

  if (!wabaId || !/^\d+$/.test(wabaId)) throw new UsageError("חסר --waba (מזהה ה-WABA, ספרות בלבד)");
  if (!phoneNumberId) throw new UsageError("חסר WHATSAPP_DEV_PHONE_NUMBER_ID ב-.env.local");
  if (!token) throw new UsageError("חסר WHATSAPP_DEV_ACCESS_TOKEN ב-.env.local");
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(databaseUrl)) {
    throw new UsageError("DATABASE_URL אינו בסיס מקומי — הסקריפט לפיתוח בלבד");
  }

  const version = process.env.WHATSAPP_GRAPH_VERSION || "v25.0";
  let info: { display_phone_number?: string; verified_name?: string };
  try {
    info = await graphJson({ token, version }, `${phoneNumberId}?fields=display_phone_number,verified_name`);
  } catch (error) {
    if (error instanceof WaApiError && error.kind === "auth") {
      // הטוקן הזמני מ-API Setup פג תוך שעות; לפיתוח מתמשך נדרש טוקן של System User
      throw new UsageError(
        `Meta דחתה את הטוקן (${error.code ?? error.status}). אם זה הטוקן הזמני מ-API Setup — הוא פג; צרו טוקן של System User ב-Business Settings והחליפו את WHATSAPP_DEV_ACCESS_TOKEN ב-.env.local.`,
      );
    }
    throw error;
  }
  if (!info.display_phone_number) throw new UsageError("Graph לא החזיר את מספר הטלפון — הטוקן או המזהה שגויים");

  const other = await db.waNumber.findFirst({
    where: { status: "CONNECTED", phoneNumberId: { not: phoneNumberId } },
    select: { id: true },
  });
  if (other) throw new UsageError("מחובר כבר מספר אחר — בגרסה 1.4 מספר אחד בלבד");

  const tokenCipher = sealWaToken(token);
  const number = await db.waNumber.upsert({
    where: { phoneNumberId },
    create: {
      phoneNumberId,
      wabaId,
      displayPhone: info.display_phone_number,
      verifiedName: info.verified_name ?? null,
      tokenCipher,
      activatedAt: new Date(),
      status: "CONNECTED",
    },
    update: {
      wabaId,
      displayPhone: info.display_phone_number,
      verifiedName: info.verified_name ?? null,
      tokenCipher,
      status: "CONNECTED",
      activatedAt: new Date(),
      connectedAt: new Date(),
      lastError: null,
    },
    select: { activatedAt: true },
  });

  console.log(`מחובר: ${info.display_phone_number} (${info.verified_name ?? "בלי שם עסקי"})`);
  console.log(`הקליטה חלה על הודעות מ-${number.activatedAt.toISOString()} ואילך`);
}

// בלי `process.exit`: יציאה בזמן שחיבור רשת עוד נסגר מפילה את Node על Windows
// (`UV_HANDLE_CLOSING`). קוד היציאה נקבע, והתהליך מסתיים כשהחיבורים נסגרים.
try {
  await main();
} catch (error) {
  console.error(error instanceof UsageError ? `שגיאה: ${error.message}` : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
