import "dotenv/config";
import { hashPassword } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { sealWaToken } from "../src/lib/whatsapp/token";
import { WA_OWNER, WA_PHONE_NUMBER_ID } from "./whatsapp-fixtures";

/**
 * זורע מצבים של מסך 17 (חיבור וואטסאפ) — התשתית של `admin-whatsapp.spec.ts`.
 *
 * **ישירות בבסיס, לא דרך חלון החיבור.** החיבור עצמו עובר ב-Meta, וב-E2E אין Meta
 * (`server-env.ts` מאפס את `WHATSAPP_*`); הזרימה מול Meta נבדקת ב-
 * `tests/integration/wa-number.test.ts` עם Meta מזויפת. מה שהמסך צריך הוא **מה
 * שהחיבור משאיר אחריו**: שורת `WaNumber` במצב מסוים, הודעות ביומן והודעת בדיקה.
 *
 * שימוש: `tsx e2e/seed-whatsapp.ts <connected|error|clear>`. **מאפס ולא מדלג**:
 * כל הרצה מוחקת את מה שזרעה קודם, כי `נתק` משנה את המצב ופרויקט הדסקטופ שרץ אחרי
 * המובייל צריך תרחיש נקי.
 */

const scenario = process.argv[2];
const HOUR = 60 * 60_000;

async function clear(): Promise<void> {
  await db.waMessage.deleteMany({ where: { number: { phoneNumberId: WA_PHONE_NUMBER_ID } } });
  await db.waNumber.deleteMany({ where: { phoneNumberId: WA_PHONE_NUMBER_ID } });
}

async function main(): Promise<void> {
  if (!["connected", "error", "clear"].includes(scenario ?? "")) {
    throw new Error("שימוש: seed-whatsapp.ts <connected|error|clear>");
  }
  await clear();
  if (scenario === "clear") return;

  const admin = await db.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("אין מנהל מערכת בבסיס — ה-seed הראשי אמור היה לזרוע אותו");

  // בעלים — לבדיקה שהמסך שמור למנהל המערכת בלבד
  await db.user.upsert({
    where: { phone: WA_OWNER.phone },
    create: { role: "OWNER", name: WA_OWNER.name, phone: WA_OWNER.phone, passwordHash: await hashPassword(WA_OWNER.password) },
    update: {},
  });

  const now = Date.now();
  const number = await db.waNumber.create({
    data: {
      phoneNumberId: WA_PHONE_NUMBER_ID,
      wabaId: "200000000000077",
      displayPhone: "+972 50-000-0077",
      verifiedName: "Y&Y אחזקה",
      tokenCipher: sealWaToken("e2e-not-a-real-token"),
      coexistence: true,
      status: scenario === "error" ? "ERROR" : "CONNECTED",
      lastError: scenario === "error" ? "partner_removed:PRIMARY_INACTIVITY" : null,
      activatedAt: new Date(now - 48 * HOUR),
      connectedAt: new Date(now - 48 * HOUR),
      connectedById: admin.id,
      contactsSyncedAt: new Date(now - 48 * HOUR),
      historySyncedAt: new Date(now - 48 * HOUR),
    },
  });

  // שתי הודעות "תקלה" משולח שוואטסאפ הסתירה, ואחת ישנה מ-30 יום שאינה נספרת
  for (const [hoursAgo, outcome] of [
    [3, "IGNORED_UNIDENTIFIED"],
    [2, "IGNORED_UNIDENTIFIED"],
    [24 * 40, "IGNORED_UNIDENTIFIED"],
    [1, "IGNORED_UNAUTHORIZED"],
  ] as const) {
    const at = new Date(now - hoursAgo * HOUR);
    await db.waMessage.create({
      data: { direction: "INBOUND", state: "DONE", numberId: number.id, type: "text", outcome, receivedAt: at, createdAt: at },
    });
  }

  await db.waMessage.create({
    data: {
      direction: "OUTBOUND",
      state: "SENT",
      numberId: number.id,
      type: "template",
      waId: "972500000000",
      authorUserId: admin.id,
      sentAt: new Date(now - 30 * 60_000),
      deliveredAt: new Date(now - 29 * 60_000),
      createdAt: new Date(now - 30 * 60_000),
    },
  });
}

// בלי top-level await: tsx מריץ את קובצי ה-`.ts` של הפרויקט כ-CommonJS
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
