import { he } from "@/lib/he";
import type { WaTemplateDefinition } from "./account";

/**
 * התבניות שהמערכת מגדירה — **בגרסה 1.4 אחת: הודעת הבדיקה** (אפיון מסך 17).
 *
 * **השם כולל גרסה.** תבנית שהוגשה ל-Meta אינה משתנה כשהנוסח ב-`he.ts` משתנה:
 * נוסח חדש הוא תבנית חדשה, בשם חדש, שעוברת אישור מחדש. בלי הגרסה בשם, המסך היה
 * מציג "מאושרת" על נוסח שאיש לא הגיש.
 */
export const TEST_TEMPLATE: WaTemplateDefinition = {
  name: "connection_test_v1",
  language: "he",
  category: "UTILITY",
  body: he.whatsappAdmin.testTemplateBody,
};

export const SYSTEM_TEMPLATES: readonly WaTemplateDefinition[] = [TEST_TEMPLATE];
