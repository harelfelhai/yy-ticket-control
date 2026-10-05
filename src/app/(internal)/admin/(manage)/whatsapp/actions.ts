"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import {
  connectWhatsappNumber,
  createWhatsappSystemTemplates,
  disconnectWhatsappNumber,
  sendWhatsappTestMessage,
} from "@/lib/services/wa-number";

/**
 * הפעולות של מסך 17 — חיבור וואטסאפ.
 *
 * ההרשאה (מנהל מערכת בלבד) נאכפת בשירות (`services/wa-number.ts`): Server Action
 * היא נקודת כניסה ציבורית, והשער של `(manage)/layout.tsx` מגן על המסך בלבד.
 */

const SCREEN = "/admin/whatsapp";

/** מזהי Meta הם ספרות בלבד — כל דבר אחר הוא הודעה שזויפה בדרך מהחלון */
const metaId = z.string().regex(/^\d{1,32}$/);

const connectSchema = z.object({
  code: z.string().min(1).max(4096),
  wabaId: metaId,
  phoneNumberId: metaId.nullable(),
  coexistence: z.boolean(),
});

export async function connectWhatsappAction(
  input: z.input<typeof connectSchema>,
): Promise<ActionResult<{ displayPhone: string }>> {
  return guard(async () => {
    const result = await connectWhatsappNumber(await requireUser(), connectSchema.parse(input));
    revalidatePath(SCREEN);
    return result;
  });
}

export async function disconnectWhatsappAction(): Promise<ActionResult> {
  return guard(async () => {
    await disconnectWhatsappNumber(await requireUser());
    revalidatePath(SCREEN);
  });
}

export async function sendWhatsappTestAction(): Promise<ActionResult<{ phone: string }>> {
  return guard(async () => {
    const result = await sendWhatsappTestMessage(await requireUser());
    revalidatePath(SCREEN);
    return result;
  });
}

export async function createWhatsappTemplatesAction(): Promise<ActionResult> {
  return guard(async () => {
    await createWhatsappSystemTemplates(await requireUser());
    revalidatePath(SCREEN);
  });
}
