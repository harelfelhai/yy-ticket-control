import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { captureError, logWarn } from "@/lib/observability/log";
import { recordWebhookEvent } from "@/lib/services/wa-webhook";
import { verifySignature } from "@/lib/whatsapp/signature";

/**
 * ה-webhook של וואטסאפ (אפיון 1.4, §2.7) — **מהיר ובלי החלטות.**
 *
 * `GET` עונה לאימות של Meta כשכתובת ה-webhook נקבעת. `POST` מאמת חתימה על
 * **הבתים הגולמיים**, שומר את הגוף כמו שהוא ויוצר ג׳וב — ומחזיר 200. כל
 * ההכרעות בתור (`services/wa-webhook.ts`), כדי שהתשובה ל-Meta תהיה מהירה
 * ושום באג בפענוח לא יאבד משלוח.
 *
 * - **חתימה שגויה** — 401, ולא נכתב דבר.
 * - **כשל בשמירה** — 500, ו-Meta מנסה שוב עד שבעה ימים. זו העמידות היחידה:
 *   אין API לשליפת הודעות שכבר נמסרו.
 * - **בלי תצורה** (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) — 404: בלי
 *   הסוד אין דרך לדעת שמשלוח בא מ-Meta. כך זה בפיתוח ובבדיקות.
 *
 * `proxy.ts` אינו כולל `/api` ב-matcher, ולכן הנתיב אינו דורש התחברות — הוא
 * מאומת בחתימה בלבד.
 */
export const dynamic = "force-dynamic";

/** Meta שולחת עד 3MB; גוף גדול בהרבה אינו ממנה, ואין סיבה לקרוא אותו */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
  const config = env.whatsapp();
  if (!config) return new NextResponse(null, { status: 404 });

  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge");
  if (params.get("hub.mode") === "subscribe" && challenge && sameSecret(params.get("hub.verify_token"), config.verifyToken)) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new NextResponse(null, { status: 403 });
}

export async function POST(request: Request) {
  const config = env.whatsapp();
  if (!config) return new NextResponse(null, { status: 404 });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    // לוג ולא issue: מי שמציף את הכתובת בבקשות מזויפות אינו תקלה שלנו
    logWarn("wa.webhook.bad_signature", { bytes: raw.byteLength });
    return new NextResponse(null, { status: 401 });
  }

  try {
    await recordWebhookEvent(raw.toString("utf8"));
  } catch (error) {
    captureError(error, { fingerprint: ["wa-webhook-store-failed"] });
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 200 });
}

/** השוואה timing-safe של ה-verify token — אורך שונה אינו שווה */
function sameSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
