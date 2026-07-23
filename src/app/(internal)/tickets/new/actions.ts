"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import type { SelectOption } from "@/lib/options";
import { canCreateTicketInSite } from "@/lib/permissions";
import { ROOMS } from "@/lib/rooms";
import { toViewer } from "@/lib/session";
import {
  DirectoryError,
  findOrCreateApartment,
  findOrCreateBuilding,
  findOrCreateDomain,
  findOrCreateProfessional,
} from "@/lib/services/directory";
import { createTicket } from "@/lib/services/tickets";

/**
 * הפעולות של מסך יצירת הפנייה.
 *
 * שלושה כללים חוצים:
 *
 * 1. כל פעולה מתחילה ב-`requireUser()` ובבדיקת הרשאה. Server Action היא
 *    נקודת כניסה ציבורית לכל דבר — העובדה שהיא נקראת מקומפוננטה מוגנת
 *    אינה מגינה עליה.
 * 2. שגיאות מוחזרות כערך ולא נזרקות — ראה `src/lib/action-result.ts`.
 * 3. הקובץ אינו מייצא טיפוסים. קובץ `"use server"` חייב לייצא רק פונקציות
 *    async, וייצוא טיפוס ממנו מפיל את המסך בזמן ריצה עם
 *    `ReferenceError: ... is not defined`.
 */

const idSchema = z.string().min(1);

/** מוודא שהמשתמש רשאי לפעול באתר, ומחזיר את המשתמש */
async function requireSiteAccess(siteId: string) {
  const user = await requireUser();
  if (!canCreateTicketInSite(toViewer(user), siteId)) {
    throw new DirectoryError(he.common.notAllowed);
  }
  return user;
}

export async function createBuildingAction(
  siteId: string,
  name: string,
): Promise<ActionResult<SelectOption>> {
  return guard(async () => {
    await requireSiteAccess(siteId);
    const building = await findOrCreateBuilding(siteId, name);
    return { id: building.id, label: building.name };
  });
}

export async function createApartmentAction(
  siteId: string,
  buildingId: string,
  number: string,
): Promise<ActionResult<SelectOption>> {
  return guard(async () => {
    await requireSiteAccess(siteId);
    const apartment = await findOrCreateApartment(buildingId, number);
    return { id: apartment.id, label: apartment.number };
  });
}

export async function createDomainAction(
  siteId: string,
  name: string,
): Promise<ActionResult<SelectOption>> {
  return guard(async () => {
    await requireSiteAccess(siteId);
    const domain = await findOrCreateDomain(name);
    return { id: domain.id, label: domain.name };
  });
}

const professionalSchema = z.object({
  name: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

export async function createProfessionalAction(
  siteId: string,
  input: z.infer<typeof professionalSchema>,
): Promise<ActionResult<SelectOption>> {
  return guard(async () => {
    await requireSiteAccess(siteId);
    const professional = await findOrCreateProfessional(professionalSchema.parse(input));
    return {
      id: professional.id,
      label: professional.name,
      hint: professional.phone ?? professional.email ?? undefined,
    };
  });
}

const recipientSchema = z.object({
  kind: z.enum(["professional", "user"]),
  id: idSchema,
});

const createTicketSchema = z.object({
  siteId: idSchema,
  buildingId: idSchema.nullable(),
  apartmentId: idSchema.nullable(),
  domainId: idSchema.nullable(),
  room: z.enum(ROOMS).nullable(),
  description: z.string(),
  recipients: z.array(recipientSchema),
  mediaIds: z.array(idSchema).max(20).optional(),
  saveAsDraft: z.boolean(),
});

/**
 * יוצר את הפנייה ומעביר למסך שלה.
 *
 * ‏redirect בהצלחה ולא החזרת מזהה: המשתמש בשטח צריך לראות מיד שהפנייה
 * קיימת ולמי היא נשלחה. `redirect` זורק חריגה מיוחדת ב-Next, ולכן הוא
 * נמצא מחוץ ל-`guard` — אחרת היא הייתה נתפסת ומדווחת כשגיאה.
 */
export async function createTicketAction(
  input: z.infer<typeof createTicketSchema>,
): Promise<{ error: string } | undefined> {
  const result = await guard(async () => {
    const parsed = createTicketSchema.parse(input);
    const user = await requireSiteAccess(parsed.siteId);
    const { ticket } = await createTicket(user, parsed);
    return ticket.id;
  });

  if (!result.ok) return { error: result.error };
  redirect(`/tickets/${result.data}`);
}
