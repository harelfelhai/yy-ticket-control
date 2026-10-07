import { NextResponse } from "next/server";
import { contentDisposition } from "./disposition";
import { selectStorage } from "./index";

/**
 * תשובת HTTP לקובץ שמור, **אחרי** שהקורא בדק הרשאה — המשותף לשני נתיבי הקבצים של
 * הערוצים: קובץ מצורף ממייל (`api/email-attachments/[id]`) וקובץ מוואטסאפ
 * (`api/wa-media/[id]`). מה שנבדל ביניהם הוא שרשרת ההרשאה; ההגשה עצמה אחת.
 *
 * **מדיה נפתחת בדפדפן, מסמך יורד.** מסמך Word/Excel שנשמר בהתכתבות (§7 שורה 64)
 * מוגש להורדה בשמו המקורי — גם בהפניה לכתובת חתומה של R2, שם הכותרת נמסרת
 * כפרמטר של הכתובת.
 */
export async function serveStoredFile(file: {
  storageKey: string;
  mimeType: string;
  filename: string | null;
  /** מסמך שאינו מדיה — יורד, ולא נפתח בדפדפן */
  download: boolean;
}): Promise<NextResponse> {
  const storage = selectStorage();
  const directUrl = await storage.createDownloadUrl(
    file.storageKey,
    file.download ? { filename: file.filename ?? "file" } : undefined,
  );
  if (directUrl) return NextResponse.redirect(directUrl);

  const body = await storage.read(file.storageKey);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(file.download ? "attachment" : "inline", file.filename),
      // פרטי ולא ציבורי: הקובץ שייך לפנייה, ואסור שיישמר במטמון משותף.
      "Cache-Control": "private, max-age=300",
    },
  });
}
