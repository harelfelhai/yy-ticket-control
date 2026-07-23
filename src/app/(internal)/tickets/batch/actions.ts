"use server";

import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { canCreateTicketInSite } from "@/lib/permissions";
import { ROOMS } from "@/lib/rooms";
import { toViewer } from "@/lib/session";
import { type BatchResult, createTicketBatch } from "@/lib/services/batch";
import { DirectoryError } from "@/lib/services/directory";

/**
 * הפעולה של מסך ההזנה המרוכזת (מסך 5).
 *
 * בוררי הרשימות הנלמדות (בניין, דירה, תחום, איש מקצוע) משותפים עם מסך
 * היצירה ומיובאים משם — מקור אמת אחד. כאן יושבת רק היצירה המרובה עצמה.
 */

const rowSchema = z.object({
  description: z.string(),
  domainId: z.string().min(1).nullable(),
  room: z.enum(ROOMS).nullable(),
  recipient: z
    .object({ kind: z.enum(["professional", "user"]), id: z.string().min(1) })
    .nullable(),
});

const batchSchema = z.object({
  siteId: z.string().min(1),
  buildingId: z.string().min(1),
  apartmentId: z.string().min(1),
  tagName: z.string(),
  sourceMediaIds: z.array(z.string().min(1)).max(20).optional(),
  rows: z.array(rowSchema).max(200),
  dispatch: z.boolean(),
});

export async function createBatchAction(
  input: z.infer<typeof batchSchema>,
): Promise<ActionResult<BatchResult>> {
  return guard(async () => {
    const parsed = batchSchema.parse(input);
    const user = await requireUser();
    if (!canCreateTicketInSite(toViewer(user), parsed.siteId)) {
      throw new DirectoryError(he.common.notAllowed);
    }
    return createTicketBatch(user, parsed);
  });
}
