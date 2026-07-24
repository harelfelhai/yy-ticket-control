"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import {
  createDomain,
  createInternalUser,
  createSite,
  mergeProfessionals,
  renameDomain,
  setUserActive,
  updateProfessional,
} from "@/lib/services/admin";

/**
 * הפעולות של מסכי הניהול (11–15).
 *
 * בדיקת ההרשאה (מנהל מערכת בלבד) יושבת בשכבת השירות (`services/admin.ts`),
 * ולכן כאן נותרת רק זהות המשתמש והמרת השגיאה להודעה. Server Action היא
 * נקודת כניסה ציבורית — הגנת ה-layout על המסכים אינה מגינה עליה.
 */

const roleSchema = z.enum(["ADMIN", "OWNER", "SITE_MANAGER"]);

export async function createSiteAction(name: string): Promise<ActionResult> {
  return guard(async () => {
    await createSite(await requireUser(), z.string().parse(name));
    revalidatePath("/admin/sites");
  });
}

const createUserSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  role: roleSchema,
  siteId: z.string().nullish(),
  password: z.string(),
});

export async function createUserAction(
  input: z.infer<typeof createUserSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    await createInternalUser(await requireUser(), createUserSchema.parse(input));
    revalidatePath("/admin/users");
  });
}

export async function setUserActiveAction(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  return guard(async () => {
    await setUserActive(await requireUser(), z.string().min(1).parse(userId), z.boolean().parse(active));
    revalidatePath("/admin/users");
  });
}

const professionalSchema = z.object({
  name: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

export async function updateProfessionalAction(
  id: string,
  input: z.infer<typeof professionalSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    await updateProfessional(await requireUser(), z.string().min(1).parse(id), professionalSchema.parse(input));
    revalidatePath("/admin/professionals");
  });
}

/** מאחד כפילות ומחזיר את שם איש המקצוע שנשאר, לנוסח האישור */
export async function mergeProfessionalsAction(
  keepId: string,
  dropId: string,
): Promise<ActionResult<string>> {
  return guard(async () => {
    const keep = await mergeProfessionals(
      await requireUser(),
      z.string().min(1).parse(keepId),
      z.string().min(1).parse(dropId),
    );
    revalidatePath("/admin/professionals");
    return keep.name;
  });
}

export async function createDomainAction(name: string): Promise<ActionResult> {
  return guard(async () => {
    await createDomain(await requireUser(), z.string().parse(name));
    revalidatePath("/admin/domains");
  });
}

export async function renameDomainAction(id: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    await renameDomain(await requireUser(), z.string().min(1).parse(id), z.string().parse(name));
    revalidatePath("/admin/domains");
  });
}
