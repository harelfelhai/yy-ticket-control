"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { resolveViewer } from "@/lib/services/viewer";
import { addTagMessage } from "@/lib/services/tags";

/**
 * כתיבה בצ׳אט הקבוצתי מצד הקבלן.
 *
 * ההרשאה נבדקת בשירות (`addTagMessage` → `canPostTagChat`), שמוודא שהתגית
 * אכן נפתחה לקבלן הזה — כמו בכל פעולה בפורטל, אין הסתמכות על כך שהמסך
 * נטען בהצלחה.
 *
 * טקסט בלבד: רישום מדיה בלי הקשר של פנייה פתוח למשתמשים פנימיים בלבד
 * (`registerMedia`), ולכן הקבלן כותב בצ׳אט הקבוצתי במילים. המדיה בצ׳אט
 * מגיעה מהמנהל (דוח בדק בית וצילומי מצב).
 */
export async function portalTagMessageAction(
  token: string,
  tagId: string,
  text: string,
): Promise<ActionResult> {
  return guard(async () => {
    const viewer = await resolveViewer(z.string().min(1).parse(token));
    await addTagMessage(viewer, z.string().min(1).parse(tagId), z.string().parse(text));
    revalidatePath(`/p/${token}/tag/${tagId}`);
  });
}
