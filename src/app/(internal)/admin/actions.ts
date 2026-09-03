"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import {
  createApartment,
  createBuilding,
  createDomain,
  createInternalUser,
  createProfessionalRecord,
  createSite,
  deleteApartment,
  deleteBuilding,
  deleteDomain,
  deleteProfessional,
  deleteSite,
  deleteUser,
  mergeProfessionals,
  renameApartment,
  renameBuilding,
  renameDomain,
  renameSite,
  setProfessionalActive,
  setSiteManagers,
  setUserActive,
  updateProfessional,
  updateUser,
} from "@/lib/services/admin";

/**
 * הפעולות של מסכי הניהול (11–15).
 *
 * בדיקת ההרשאה (מנהל מערכת בלבד) יושבת בשכבת השירות (`services/admin.ts`),
 * ולכן כאן נותרת רק זהות המשתמש והמרת השגיאה להודעה. Server Action היא
 * נקודת כניסה ציבורית — הגנת ה-layout על המסכים אינה מגינה עליה.
 */

const roleSchema = z.enum(["ADMIN", "OWNER", "SITE_MANAGER"]);

/** מזהה חובה. חוזר בכל פעולה, ולכן מנורמל במקום אחד ולא בכל קריאה מחדש. */
const id = (value: string) => z.string().min(1).parse(value);

/** רשימת מזהים שמגיעה מהלקוח — כל איבר מנורמל, ולא רק המערך. */
const idList = z.array(z.string().min(1));

export async function createSiteAction(input: {
  name: string;
  managerIds: string[];
}): Promise<ActionResult> {
  return guard(async () => {
    await createSite(
      await requireUser(),
      z.string().parse(input.name),
      idList.parse(input.managerIds),
    );
    revalidatePath("/admin/sites");
  });
}

/**
 * שיוך מנהלי העבודה לאתר — נערך מתוך דיאלוג הפרטים (0.7).
 *
 * ‏`/admin/users` מרוענן גם הוא: שיוך מנהל משנה את עמודת "אתר" שלו שם,
 * ובלי הרענון המסך השני מציג את השיוך הישן עד ניווט מלא.
 */
export async function setSiteManagersAction(
  siteId: string,
  managerIds: string[],
): Promise<ActionResult> {
  return guard(async () => {
    await setSiteManagers(await requireUser(), id(siteId), idList.parse(managerIds));
    revalidatePath("/admin/sites");
    revalidatePath("/admin/users");
  });
}

export async function renameSiteAction(siteId: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    await renameSite(await requireUser(), id(siteId), z.string().parse(name));
    revalidatePath("/admin/sites");
  });
}

export async function deleteSiteAction(siteId: string): Promise<ActionResult> {
  return guard(async () => {
    await deleteSite(await requireUser(), id(siteId));
    revalidatePath("/admin/sites");
  });
}

// ──────────────────────── בניינים ודירות (מסך 16) ────────────────────────
//
// ‏`siteId` נמסר לכל פעולה גם כשהשירות אינו זקוק לו: הוא הנתיב שיש לרענן.
// הלקוח יושב על `/admin/sites/[siteId]` ויודע אותו, והחלופה — לשלוף את
// האתר מהדירה דרך הבניין בכל פעולה — היא שאילתה נוספת עבור מידע שכבר קיים.

export async function createBuildingAction(siteId: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    await createBuilding(await requireUser(), id(siteId), z.string().parse(name));
    revalidatePath(`/admin/sites/${siteId}`);
  });
}

export async function renameBuildingAction(
  siteId: string,
  buildingId: string,
  name: string,
): Promise<ActionResult> {
  return guard(async () => {
    await renameBuilding(await requireUser(), id(buildingId), z.string().parse(name));
    revalidatePath(`/admin/sites/${siteId}`);
  });
}

export async function deleteBuildingAction(
  siteId: string,
  buildingId: string,
): Promise<ActionResult> {
  return guard(async () => {
    await deleteBuilding(await requireUser(), id(buildingId));
    revalidatePath(`/admin/sites/${siteId}`);
  });
}

export async function createApartmentAction(
  siteId: string,
  buildingId: string,
  number: string,
): Promise<ActionResult> {
  return guard(async () => {
    await createApartment(await requireUser(), id(buildingId), z.string().parse(number));
    revalidatePath(`/admin/sites/${siteId}`);
  });
}

export async function renameApartmentAction(
  siteId: string,
  apartmentId: string,
  number: string,
): Promise<ActionResult> {
  return guard(async () => {
    await renameApartment(await requireUser(), id(apartmentId), z.string().parse(number));
    revalidatePath(`/admin/sites/${siteId}`);
  });
}

export async function deleteApartmentAction(
  siteId: string,
  apartmentId: string,
): Promise<ActionResult> {
  return guard(async () => {
    await deleteApartment(await requireUser(), id(apartmentId));
    revalidatePath(`/admin/sites/${siteId}`);
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

const updateUserSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
});

/** עריכת פרטי קשר בלבד — תפקיד ואתר אינם נערכים. ראה `updateUser` בשירות. */
export async function updateUserAction(
  userId: string,
  input: z.infer<typeof updateUserSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    await updateUser(await requireUser(), id(userId), updateUserSchema.parse(input));
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

/**
 * מוחק משתמש שאין אליו הפניות (הכרעת מימוש 1.0). החסימה, ההגנה מפני מחיקה
 * עצמית וההגנה על המנהל האחרון — כולן בשירות, כי Server Action היא נקודת
 * כניסה ציבורית ובדיקה שיושבת רק כאן ניתנת לעקיפה בנתיב חדש.
 */
export async function deleteUserAction(userId: string): Promise<ActionResult> {
  return guard(async () => {
    await deleteUser(await requireUser(), id(userId));
    revalidatePath("/admin/users");
  });
}

const professionalSchema = z.object({
  name: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

/**
 * הקמת איש מקצוע ממסך הניהול (0.7).
 *
 * מרענן גם את `/tickets/new`: בורר הנמענים שם נטען בשרת, ואיש מקצוע שהוקם
 * זה עתה לא היה מופיע בו עד ניווט מלא.
 */
export async function createProfessionalAction(
  input: z.infer<typeof professionalSchema>,
): Promise<ActionResult> {
  return guard(async () => {
    await createProfessionalRecord(await requireUser(), professionalSchema.parse(input));
    revalidatePath("/admin/professionals");
    revalidatePath("/tickets/new");
  });
}

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

export async function setProfessionalActiveAction(
  professionalId: string,
  active: boolean,
): Promise<ActionResult> {
  return guard(async () => {
    await setProfessionalActive(await requireUser(), id(professionalId), z.boolean().parse(active));
    revalidatePath("/admin/professionals");
  });
}

export async function deleteProfessionalAction(professionalId: string): Promise<ActionResult> {
  return guard(async () => {
    await deleteProfessional(await requireUser(), id(professionalId));
    revalidatePath("/admin/professionals");
  });
}

export async function createDomainAction(name: string): Promise<ActionResult> {
  return guard(async () => {
    await createDomain(await requireUser(), z.string().parse(name));
    revalidatePath("/admin/domains");
  });
}

export async function renameDomainAction(domainId: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    await renameDomain(await requireUser(), id(domainId), z.string().parse(name));
    revalidatePath("/admin/domains");
  });
}

export async function deleteDomainAction(domainId: string): Promise<ActionResult> {
  return guard(async () => {
    await deleteDomain(await requireUser(), id(domainId));
    revalidatePath("/admin/domains");
  });
}
