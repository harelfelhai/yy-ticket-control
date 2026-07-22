import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { MAX_FILE_BYTES } from "@/lib/storage";
import { writeLocalObject } from "@/lib/storage/local";

/**
 * יעד ההעלאה של הדרייבר המקומי — **פיתוח בלבד**.
 *
 * בפרודקשן הדפדפן מעלה ישירות ל-R2 בכתובת חתומה, וה-route הזה מסרב לפעול.
 * קיומו מאפשר לקוד הלקוח להיות זהה בשתי הסביבות: הוא תמיד שולח PUT לכתובת
 * שקיבל, בלי לדעת מי מקבל אותה.
 *
 * ההרשאה כבר נבדקה בשלב הרישום, שהוא היחיד שיוצר שורת `MediaFile` ומחזיר
 * את המפתח. כאן נבדק שהמפתח אכן שייך לרשומה שנרשמה וטרם הועלתה — כך
 * הכתובת אינה מקום שאפשר לדחוף אליו קבצים שרירותיים, וגם לא לדרוס קובץ
 * קיים.
 */
export async function PUT(request: Request, context: RouteContext<"/api/media/upload/[...key]">) {
  if (env.r2() || env.isProduction()) {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }

  const { key } = await context.params;
  const storageKey = key.join("/");

  const media = await db.mediaFile.findUnique({ where: { storageKey } });
  if (!media || media.uploaded) {
    return NextResponse.json({ error: "unknown key" }, { status: 404 });
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "bad size" }, { status: 413 });
  }

  await writeLocalObject(storageKey, body);

  // הגודל האמיתי גובר על מה שהלקוח הצהיר ברישום: ההצהרה היא קלט, והמדידה
  // כאן היא עובדה.
  await db.mediaFile.update({
    where: { id: media.id },
    data: { sizeBytes: body.byteLength },
  });

  return new NextResponse(null, { status: 204 });
}
