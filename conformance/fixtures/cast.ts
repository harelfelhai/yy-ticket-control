/**
 * הצוות שהבדיקות משחקות בו — נתונים טהורים, בלי גישה למסד.
 *
 * **למה זה נדרש:** `prisma/seed.ts` יוצר משתמש אחד בלבד (ADMIN), ולכן כל
 * חבילת ה-E2E הקיימת רצה כמנהל מערכת. המשמעות היא ש-§5.ז — לב מטריצת
 * ההרשאות — כמעט אינו נבדק דרך הדפדפן: אין OWNER שינסה לסגור פנייה שלא
 * פתח, ואין SITE_MANAGER שינסה לגעת באתר שאינו שלו. בלי הצוות הזה אי אפשר
 * לאמת את BR-40…BR-53 בכלל.
 *
 * שני מנהלי עבודה על **אותו** אתר אינם כפילות: §5.ד נכתב בדיוק בשבילם
 * ("בתור משותף לשני מנהלי עבודה קיים סיכון ששניהם יטפלו באותה פנייה"),
 * ו-BR-34 דורש שני מנהלים שעורכים במקביל.
 */

export type Role = "ADMIN" | "OWNER" | "SITE_MANAGER";

export interface CastMember {
  key: string;
  name: string;
  phone: string;
  email?: string;
  password: string;
  role: Role;
  /** שם האתר; רלוונטי ל-SITE_MANAGER בלבד */
  site?: string;
}

/** האתר שה-seed יוצר */
export const SITE_A = "אתר לדוגמה";
/** אתר שני — נוצר רק לחבילת ההתאמה, כדי לאמת מידור לפי אתר */
export const SITE_B = "אתר שני";

export const BUILDINGS_A = ["בניין א", "בניין ב"] as const;
export const BUILDINGS_B = ["בניין ג"] as const;
export const APARTMENTS = ["1", "2", "3"] as const;

const PASSWORD = "conformance-1234";

export const CAST = {
  /** נוצר ב-seed; הסיסמה נקבעת דרך SEED_ADMIN_PASSWORD */
  admin: {
    key: "admin",
    name: "מנהל ראשי",
    phone: "0500000000",
    password: "dev-admin-1234",
    role: "ADMIN",
  },
  owner: {
    key: "owner",
    name: "בעלים לבדיקה",
    phone: "0500000001",
    email: "owner@conformance.test",
    password: PASSWORD,
    role: "OWNER",
  },
  managerA: {
    key: "managerA",
    name: "מנהל עבודה א",
    phone: "0500000002",
    email: "manager-a@conformance.test",
    password: PASSWORD,
    role: "SITE_MANAGER",
    site: SITE_A,
  },
  /** מנהל שני על אותו אתר — §5.ד (התור המשותף) ו-BR-34 (עריכה מקבילה) */
  managerA2: {
    key: "managerA2",
    name: "מנהל עבודה א2",
    phone: "0500000003",
    email: "manager-a2@conformance.test",
    password: PASSWORD,
    role: "SITE_MANAGER",
    site: SITE_A,
  },
  /** מנהל האתר השני — כל בדיקת מידור חוצה-אתרים עוברת דרכו */
  managerB: {
    key: "managerB",
    name: "מנהל עבודה ב",
    phone: "0500000004",
    email: "manager-b@conformance.test",
    password: PASSWORD,
    role: "SITE_MANAGER",
    site: SITE_B,
  },
} as const satisfies Record<string, CastMember>;

export type CastKey = keyof typeof CAST;

/**
 * אנשי מקצוע קבועים. השלישי — בלי מייל — קיים בשביל חיווי השליחה
 * ("אין מייל — שלח בוואטסאפ") ובשביל §5.ו: נמען בלי דרך ליצור איתו קשר.
 * נמען **בלי טלפון ובלי מייל** אינו נוצר כאן במכוון: השירות חוסם יצירה כזו,
 * וזו בדיוק הדרישה שנבדקת דרך ה-UI (BR-39).
 */
export const PROS = {
  full: { name: "קבלן מלא", phone: "0521111111", email: "pro-full@conformance.test" },
  second: { name: "קבלן שני", phone: "0522222222", email: "pro-second@conformance.test" },
  phoneOnly: { name: "קבלן בלי מייל", phone: "0523333333" },
} as const;
