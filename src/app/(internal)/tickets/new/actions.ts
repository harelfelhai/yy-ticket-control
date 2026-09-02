"use server";

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
  assertLocationInSite,
  findOrCreateApartment,
  findOrCreateBuilding,
  findOrCreateDomain,
  findOrCreateProfessional,
} from "@/lib/services/directory";
import { claimWhatsAppAutoOpen } from "@/lib/services/delivery";
import { findOrCreateTag } from "@/lib/services/tags";
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
    // הבניין מגיע מהלקוח: לוודא שהוא באתר שההרשאה ניתנה עליו, אחרת מנהל
    // אתר יכול ליצור דירות תחת בניין של אתר אחר.
    await assertLocationInSite({ siteId, buildingId });
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

/**
 * ‏`needsWhatsApp` מוחזר מהשרת ולא מחושב בלקוח מהשדות שהוקלדו, **ובכוונה**.
 *
 * ‏`findOrCreateProfessional` מחזירה איש מקצוע **קיים** כשהטלפון כבר במערכת
 * (זיהוי כפילות לפי טלפון), ולזה עשוי להיות מייל שהמקליד לא ידע עליו. חישוב
 * בלקוח מתוך הטופס היה פותח וואטסאפ למי שיקבל ממילא מייל — ובכיוון ההפוך,
 * מדלג עליו למי שלא.
 */
export async function createProfessionalAction(
  siteId: string,
  input: z.infer<typeof professionalSchema>,
): Promise<ActionResult<SelectOption & { needsWhatsApp: boolean }>> {
  return guard(async () => {
    await requireSiteAccess(siteId);
    const professional = await findOrCreateProfessional(professionalSchema.parse(input));
    return {
      id: professional.id,
      label: professional.name,
      hint: professional.phone ?? professional.email ?? undefined,
      needsWhatsApp: Boolean(professional.phone) && !professional.email,
    };
  });
}

const recipientSchema = z.object({
  kind: z.enum(["professional", "user"]),
  id: idSchema,
});

/**
 * יוצר תגית בשם, או מחזיר קיימת. תגיות אינן ממודרות לפי אתר (הן עשויות
 * לחצות אתרים), ולכן די באימות משתמש מחובר.
 */
export async function createTagAction(name: string): Promise<ActionResult<SelectOption>> {
  return guard(async () => {
    const user = await requireUser();
    const tag = await findOrCreateTag(z.string().parse(name), user.id);
    return { id: tag.id, label: tag.name };
  });
}

const createTicketSchema = z.object({
  siteId: idSchema,
  buildingId: idSchema.nullable(),
  apartmentId: idSchema.nullable(),
  domainId: idSchema.nullable(),
  room: z.enum(ROOMS).nullable(),
  description: z.string(),
  recipients: z.array(recipientSchema),
  mediaIds: z.array(idSchema).max(20).optional(),
  tagIds: z.array(idSchema).max(10).optional(),
  saveAsDraft: z.boolean(),
  /**
   * האם ללקוח יש לשונית פתוחה שממתינה ליעד.
   *
   * מגיע מהלקוח מפני שרק הוא יודע: `window.open` נחסם בחלק מהדפדפנים,
   * וסימון "נפתח" עבור לשונית שלא נפתחה היה מסתיר את המשימה שנשארה.
   */
  autoOpenWhatsApp: z.boolean().optional(),
});

/**
 * **הפעולה מחזירה ואינה מנווטת בעצמה, מאז שהוואטסאפ נפתח אוטומטית.**
 *
 * ‏`redirect()` בשרת גורם ללקוח לנווט, וההבטחה שהלקוח המתין לה אינה נפתרת
 * לעולם — כלומר הטופס לעולם אינו מקבל את התשובה. זה היה תקין כל עוד לא היה
 * מה לעשות איתה, אבל הלשונית שנפתחה בלחיצה **ממתינה ליעד**, והיעד מגיע רק
 * מכאן. הניווט עבר ל-`router.push` בטופס; מבחינת המשתמש דבר לא השתנה.
 */
export async function createTicketAction(
  input: z.infer<typeof createTicketSchema>,
): Promise<ActionResult<{ ticketId: string; waAutoOpen: string | null }>> {
  return guard(async () => {
    const parsed = createTicketSchema.parse(input);
    const user = await requireSiteAccess(parsed.siteId);
    const { ticket } = await createTicket(user, parsed);

    return {
      ticketId: ticket.id,
      /*
       * הנמען הראשון שלא יקבל שום הודעה — ורק הוא.
       *
       * חוסם החלונות הקופצים מתיר לשונית אחת למחווה ומפיל בשקט את כל מה
       * שאחריה, ולכן פתיחת חמש לשוניות הייתה נראית כשליחה לחמישה ומגיעה
       * לאחד. השאר מופיעים ב"נותר לשלוח" במסך שאליו המנהל נוחת.
       *
       * בטיוטה הרשימה ריקה ממילא: טיוטה אינה משויכת לאיש.
       */
      waAutoOpen: await claimWhatsAppAutoOpen(
        ticket.assignments.map((a) => a.id),
        parsed.autoOpenWhatsApp === true,
      ),
    };
  });
}
