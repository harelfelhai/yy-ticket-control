"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { toViewer } from "@/lib/session";
import {
  addTagMessage,
  deleteTag,
  getTagContractorLink,
  grantTagAccess,
  renameTag,
  revokeTagAccess,
} from "@/lib/services/tags";

/**
 * הפעולות של מסך התגית (מסך 6).
 *
 * כמו בשאר המערכת, בדיקות ההרשאה יושבות בשכבת השירות (`services/tags.ts`)
 * ולא כאן — כך גם הפורטל, גם הג׳וב וגם כל קורא עתידי מקבלים אותה בדיקה.
 * כאן נותרת רק זהות המשתמש והמרת השגיאה להודעה.
 */

async function viewer() {
  return toViewer(await requireUser());
}

const mediaIdsSchema = z.array(z.string().min(1)).max(20).optional();

export async function addTagMessageAction(
  tagId: string,
  text: string,
  mediaIds?: string[],
): Promise<ActionResult> {
  return guard(async () => {
    await addTagMessage(
      await viewer(),
      z.string().min(1).parse(tagId),
      z.string().parse(text),
      mediaIdsSchema.parse(mediaIds) ?? [],
    );
    revalidatePath(`/tags/${tagId}`);
  });
}

/**
 * פותח את התגית לקבלנים ומחזיר את נוסח האישור מהאפיון.
 * הנוסח מוחזר ולא נזרק, כדי שהמסך יציג "התגית נפתחה ל… הם יראו את הצ׳אט
 * הקבוצתי בלבד" — הבהרה שהיא כל העניין של הפעולה.
 */
export async function grantTagAccessAction(
  tagId: string,
  professionalIds: string[],
): Promise<ActionResult<string[]>> {
  return guard(async () => {
    const names = await grantTagAccess(
      await viewer(),
      z.string().min(1).parse(tagId),
      z.array(z.string().min(1)).parse(professionalIds),
    );
    revalidatePath(`/tags/${tagId}`);
    return names;
  });
}

export async function revokeTagAccessAction(
  tagId: string,
  professionalId: string,
): Promise<ActionResult> {
  return guard(async () => {
    await revokeTagAccess(
      await viewer(),
      z.string().min(1).parse(tagId),
      z.string().min(1).parse(professionalId),
    );
    revalidatePath(`/tags/${tagId}`);
  });
}

/** משנה שם תגית — מנהל מערכת בלבד (הבדיקה בשירות) */
export async function renameTagAction(id: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    await renameTag(await requireUser(), z.string().min(1).parse(id), z.string().parse(name));
    revalidatePath("/tags");
  });
}

/** מוחק תגית ריקה — מנהל מערכת בלבד (הבדיקה בשירות) */
export async function deleteTagAction(id: string): Promise<ActionResult> {
  return guard(async () => {
    await deleteTag(await requireUser(), z.string().min(1).parse(id));
    revalidatePath("/tags");
  });
}

/** מחזיר את קישור הגישה של קבלן שנפתחה לו התגית, כדי שהמנהל ישלח לו אותו */
export async function getTagContractorLinkAction(
  tagId: string,
  professionalId: string,
): Promise<ActionResult<string>> {
  return guard(async () => {
    return getTagContractorLink(
      await viewer(),
      z.string().min(1).parse(tagId),
      z.string().min(1).parse(professionalId),
    );
  });
}
