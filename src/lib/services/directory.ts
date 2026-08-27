import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import {
  compareApartmentNumbers,
  looksLikeEmail,
  normalizeApartmentNumber,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from "@/lib/normalize";

/**
 * הרשימות הנלמדות: בניין, דירה, תחום ואיש מקצוע.
 *
 * אף אחת מהן אינה **דורשת** הגדרה מראש — הן נוצרות ברגע שמנהל עבודה מקליד
 * ערך שאינו קיים. זה מה שמאפשר להתחיל לעבוד בלי שלב הזנה מוקדם, וזה גם
 * הסיכון: כל שגיאת הקלדה הופכת לישות חדשה שמפצלת דוחות ותגיות. שתי הגנות
 * פועלות כאן:
 *
 * 1. נרמול לפני חיפוש — "07" ו-"7" הן אותה דירה, "050-1234567" ו-
 *    "0501234567" הם אותו קבלן.
 * 2. חיפוש-או-יצירה אטומי — שני מנהלים שמקלידים את אותו בניין באותו רגע
 *    מקבלים את אותה רשומה, ולא שתיים.
 *
 * ההגנה השלישית היא בממשק: הערכים מוצגים כרשימת בחירה קצרה ולא כשדה
 * טקסט חופשי, כדי שהמסלול הקל יהיה בחירה בקיים ולא יצירה של חדש.
 *
 * מגרסה 0.3 קיימת גם הדרך ההפוכה: בניינים ודירות ניתנים להגדרה מראש במסך
 * 16 (`/admin/sites/[siteId]`), ואפשר לתקן שם או למחוק רשומה שנוצרה בטעות.
 * ההזנה תוך כדי עבודה לא הוסרה — נוספה לה אלטרנטיבה ודרך תיקון.
 */

/** שגיאות הרשימות הנלמדות נועדו להיראות על ידי המשתמש, בעברית */
export class DirectoryError extends UserFacingError {}

/**
 * מוצא בניין קיים או יוצר חדש.
 * ‏upsert ולא findFirst+create: המפתח הייחודי (siteId, name) הופך את
 * הפעולה לאטומית, ומונע כפילות בהזנה מרוכזת שבה נוצרות עשרות פניות ברצף.
 */
export async function findOrCreateBuilding(siteId: string, rawName: string) {
  const name = normalizeName(rawName);
  if (!name) throw new DirectoryError(he.directory.buildingNameRequired);

  return db.building.upsert({
    where: { siteId_name: { siteId, name } },
    update: {},
    create: { siteId, name },
  });
}

export async function findOrCreateApartment(buildingId: string, rawNumber: string) {
  const number = normalizeApartmentNumber(rawNumber);
  if (!number) throw new DirectoryError(he.directory.apartmentNumberRequired);

  return db.apartment.upsert({
    where: { buildingId_number: { buildingId, number } },
    update: {},
    create: { buildingId, number },
  });
}

export async function findOrCreateDomain(rawName: string) {
  const name = normalizeName(rawName);
  if (!name) throw new DirectoryError(he.directory.domainNameRequired);

  return db.domain.upsert({ where: { name }, update: {}, create: { name } });
}

/**
 * מאמת שאיש מקצוע שמשויך לפנייה **פעיל** (הכרעת 0.4).
 *
 * **למה בשרת ולא רק בבורר.** ההשבתה מוציאה את איש המקצוע מרשימות הבחירה,
 * אבל המזהה מגיע מהלקוח: קישור שנשמר, טופס שהיה פתוח לפני ההשבתה, או
 * טיוטה שנשמרה מקומית וששוגרה אחר כך. בלי הבדיקה הזו ההשבתה היא קוסמטיקה
 * — בדיוק כמו `assertLocationInSite` ששומר על אותו גבול בשדות המיקום.
 *
 * **מה שאינו נחסם כאן, בכוונה:** שיוכים שכבר קיימים. השבתה מוציאה אותו
 * מהעתיד ולא מוחקת את העבר, ולכן פנייה פתוחה שהוא כבר עליה ממשיכה לעבוד
 * — כולל הקישור האישי שלו, שהוא עדיין נדרש לסגור דרכו מה שנפתח לפניו.
 */
export async function assertProfessionalsActive(professionalIds: string[]): Promise<void> {
  const unique = [...new Set(professionalIds)];
  if (unique.length === 0) return;

  const inactive = await db.professional.findMany({
    where: { id: { in: unique }, active: false },
    select: { name: true },
  });
  if (inactive.length > 0) {
    throw new DirectoryError(he.directory.professionalInactive(inactive.map((p) => p.name)));
  }
}

/**
 * מאמת שנמען **פנימי** רשאי לקבל פנייה באתר נתון (הכרעת 0.7).
 *
 * **התאום החסר של `assertProfessionalsActive`.** הבדיקה על אנשי מקצוע קיימת
 * מפני שהמזהה מגיע מהלקוח, ובלעדיה ההשבתה קוסמטית — והנימוק הזה חל מילה
 * במילה גם על משתמשים פנימיים, אבל הצד שלהם לא נבדק כלל. התוצאה: אפשר היה
 * לשייך לפנייה משתמש מאתר אחר (או משתמש מושבת), והמערכת הייתה שולחת לו
 * מייל עם הבניין, הדירה, התחום והתיאור המלא — בדיוק המידע ש-`canViewTicket`
 * קיימת כדי למנוע ממנו — ואז מציגה לו 404 כשילחץ.
 *
 * הכלל זהה לזה שהממשק כבר מיישם בבורר הנמענים
 * (`tickets/[id]/page.tsx`): פעיל, ושייך לאתר הפנייה או חוצה-אתרים
 * (`siteId: null` — מנהל מערכת ובעלים). כאן הוא נאכף בשרת, ששם הוא נחוץ.
 *
 * הבדיקה היא על הספירה ולא על השמות: מזהה שאינו קיים כלל נופל באותו תנאי,
 * ואין טעם בשתי הודעות שגיאה למצב אחד.
 */
export async function assertUsersAssignable(
  userIds: string[],
  siteId: string,
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;

  const assignable = await db.user.count({
    where: {
      id: { in: unique },
      active: true,
      OR: [{ siteId }, { siteId: null }],
    },
  });

  if (assignable !== unique.length) {
    throw new DirectoryError(he.directory.userNotAssignable);
  }
}

/**
 * מאמת ששיוך מיקום לפנייה עקבי: הבניין שייך לאתר, והדירה לבניין ולאתר.
 *
 * ההרשאה נבדקת על האתר (`canCreateTicketInSite`/`canEditTicketFields`), אבל
 * מזהי הבניין והדירה מגיעים מהלקוח ואינם מאומתים מולו. בלי הבדיקה הזו מנהל
 * אתר שמשיג מזהה (cuid) של בניין באתר אחר יכול לשייך אליו פנייה או ליצור
 * תחתיו דירות — זיהום חוצה-אתרים שקט של הרשומות. שדות null אינם נבדקים:
 * טיוטה יכולה להישמר בלי מיקום מלא.
 */
export async function assertLocationInSite(input: {
  siteId: string;
  buildingId?: string | null;
  apartmentId?: string | null;
}): Promise<void> {
  if (input.buildingId) {
    const building = await db.building.findUnique({
      where: { id: input.buildingId },
      select: { siteId: true },
    });
    if (!building || building.siteId !== input.siteId) {
      throw new DirectoryError(he.directory.locationMismatch);
    }
  }

  if (input.apartmentId) {
    const apartment = await db.apartment.findUnique({
      where: { id: input.apartmentId },
      select: { buildingId: true, building: { select: { siteId: true } } },
    });
    // הדירה חייבת להשתייך לאתר, ואם נמסר גם בניין — לאותו בניין.
    if (
      !apartment ||
      apartment.building.siteId !== input.siteId ||
      (input.buildingId && apartment.buildingId !== input.buildingId)
    ) {
      throw new DirectoryError(he.directory.locationMismatch);
    }
  }
}

export interface ProfessionalInput {
  name: string;
  phone?: string | null;
  email?: string | null;
}

/**
 * מנרמל ומאמת פרטי איש מקצוע.
 *
 * "חובה טלפון או מייל" נאכף כאן ולא ב-DB: זהו אילוץ עסקי שנובע מכך שבלי
 * אחד מהם אי אפשר לשגר אליו את הפנייה כלל (אפיון §5.ו), ועדיף שיחזיר
 * הודעה בעברית שאומרת למה, מאשר כשל אילוץ גולמי.
 */
export function prepareProfessional(input: ProfessionalInput) {
  const name = normalizeName(input.name);
  if (!name) throw new DirectoryError(he.directory.professionalNameRequired);

  const phone = normalizePhone(input.phone ?? "");
  const email = normalizeEmail(input.email ?? "");

  if (!phone && !email) throw new DirectoryError(he.notices.cannotSendNoContact);
  if (email && !looksLikeEmail(email)) throw new DirectoryError(he.directory.invalidEmail);

  return { name, phone: phone || null, email: email || null };
}

export async function createProfessional(input: ProfessionalInput) {
  return db.professional.create({ data: prepareProfessional(input) });
}

/**
 * מוצא איש מקצוע קיים לפי טלפון או מייל, או יוצר חדש.
 *
 * ההתאמה היא לפי פרטי הקשר ולא לפי השם, כי השם נכתב אחרת בכל פעם
 * ("יוסי", "יוסי חשמלאי", "יוסי כהן") בעוד שהטלפון יציב. התאמה לפי שם
 * הייתה מייצרת בדיוק את הכפילויות שהנרמול נועד למנוע.
 */
export async function findOrCreateProfessional(input: ProfessionalInput) {
  const prepared = prepareProfessional(input);

  const existing = await db.professional.findFirst({
    where: {
      OR: [
        ...(prepared.phone ? [{ phone: prepared.phone }] : []),
        ...(prepared.email ? [{ email: prepared.email }] : []),
      ],
    },
  });

  if (existing) return existing;
  return db.professional.create({ data: prepared });
}

/**
 * רשימות לתצוגה במסכי היצירה. מוגבלות לאתר, כי מנהל עבודה פועל באתר אחד.
 *
 * הדירות ממוינות בסדר טבעי ולא לקסיקוגרפי: בבניין עם 50 דירות, בורר שמציג
 * 1, 10, 11, 12, 2 מאלץ לחפש כל בחירה מחדש.
 */
export async function listSiteDirectory(siteId: string) {
  const [buildings, domains, professionals] = await Promise.all([
    db.building.findMany({
      where: { siteId },
      orderBy: { name: "asc" },
      include: { apartments: true },
    }),
    db.domain.findMany({ orderBy: { name: "asc" } }),
    // מושבתים אינם בבורר (0.4): זו כל מטרת ההשבתה. פניות קיימות אינן
    // נשלפות מכאן ולכן אינן מושפעות.
    db.professional.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return {
    buildings: buildings.map((building) => ({
      ...building,
      apartments: [...building.apartments].sort((a, b) =>
        compareApartmentNumbers(a.number, b.number),
      ),
    })),
    domains,
    professionals,
  };
}
