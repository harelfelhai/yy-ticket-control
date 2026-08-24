import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOMS } from "@/lib/rooms";
import { sourceFiles, stripComments } from "../../unit/source-scan";

/**
 * §6 — גבולות ההיקף. **ההיעדר הוא הדרישה.**
 *
 * זהו הסעיף היחיד באפיון שבו "לא מימשנו את זה" היא התוצאה הנכונה, ולכן
 * הוא גם היחיד שאף אחד לא בודק: פיצ׳ר שהוחלט לדחות ונכנס בכל זאת — דרך
 * ספרייה, דרך העתקה ממערכת אחרת, או דרך "זה היה קל" — עובר בשקט מוחלט.
 *
 * הסריקה היא על קוד המקור, כי אין מסך שאפשר לצלם כדי להראות שמשהו **לא**
 * קיים.
 */

const SRC = join(process.cwd(), "src");

/** הסכימה כפי שהיא, כולל הערות — נדרשת כשהשאלה היא מה **מתועד** */
const SCHEMA_RAW = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

/**
 * הסכימה **בלי הערות**.
 *
 * ההערות כאן עשירות ומזכירות במפורש מושגים שנדחו ("רדום בגרסה זו, ראה
 * Gate G8"), ולכן סריקה על הטקסט הגולמי מוצאת אותם וקובעת שהפיצ׳ר קיים.
 * ‏`stripComments` המשותף מנקה רק `//` שפותח שורה — במכוון, כדי ש-`https://`
 * בתוך מחרוזת לא יבלע את השורה. בסכימת Prisma אין מחרוזות כאלה בגושי
 * ה-enum, ולכן כאן מותר לנקות גם הערה שנגררת אחרי ערך.
 */
const SCHEMA = stripComments(SCHEMA_RAW).replace(/\/\/.*$/gm, "");

/**
 * כל קוד המקור, **בלי הערות**. בפרויקט הזה ההערות מתעדות במכוון את מה
 * שנדחה ("Explicitly not WhatsApp Business API"), ולכן סריקה שכוללת אותן
 * מדווחת על פיצ׳ר קיים בדיוק במקום שבו הקוד מסביר למה הוא אינו קיים.
 */
function allSource(): string {
  return sourceFiles(SRC)
    .map((file) => stripComments(readFileSync(file, "utf8")))
    .join("\n");
}

describe("§6 — מה שנדחה במפורש אינו קיים במערכת", () => {
  const source = allSource();

  it("SC-OUT-16 — אין ערוץ SMS", () => {
    // התוכנית: "אין SMS. אין WhatsApp API בגרסה זו."
    expect(source).not.toMatch(/twilio|nexmo|vonage|019sms|smsProvider|sendSms/i);
  });

  it("SC-OUT-01 — ערוץ הוואטסאפ הוא שיתוף ידני בלבד, בלי API נכנס", () => {
    expect(source).toMatch(/wa\.me/);
    expect(source).not.toMatch(/graph\.facebook\.com|whatsapp.*business.*api/i);
    // ‏Channel.WHATSAPP קיים במודל (רדום, Gate G8) אך אין נתיב קליטה.
    expect(SCHEMA).toMatch(/WHATSAPP/);
    expect(source).not.toMatch(/webhook.*whatsapp|whatsapp.*webhook/i);
  });

  it("SC-OUT-02 — אין אינטגרציית יומן גוגל", () => {
    expect(source).not.toMatch(/googleapis|calendar\.google|google-auth-library/i);
  });

  it("SC-OUT-03 — אין סטופרים, ימי עיכוב או סגירה רטרואקטיבית", () => {
    expect(SCHEMA).not.toMatch(/stopwatch|delayDays|retroactive|pausedAt|resumedAt/i);
  });

  it("SC-OUT-04 — הדייר אינו משתמש: השם תלוי בדירה ואין לו רשומת משתמש", () => {
    expect(SCHEMA).toMatch(/residentName\s+String\?/);
    expect(SCHEMA).not.toMatch(/model\s+Resident\b/);
    expect(SCHEMA).not.toMatch(/RESIDENT/);
  });

  it("SC-OUT-05 — אין חיתוך אזורים מתוך PDF", () => {
    expect(source).not.toMatch(/pdf-lib|pdfjs|cropBox|crop\(/i);
  });

  it("SC-OUT-06/DM-R02 — רשימת החדרים היא 11 ערכים, בלי חצר ושטח חוץ", () => {
    expect(ROOMS).toHaveLength(11);
    expect(ROOMS).not.toContain("YARD");
    expect(ROOMS).not.toContain("GARDEN");
    expect(ROOMS).not.toContain("OUTDOOR");
  });

  it("SC-OUT-07/DM-F22 — אין שדה דחיפות או עדיפות", () => {
    expect(SCHEMA).not.toMatch(/urgency|priority|severity/i);
  });

  it("SC-OUT-08/A4-09 — לנמען ארבעה סטטוסים בלבד, ואין 'בטיפול' או 'לא יכול לקחת'", () => {
    const enumBlock = SCHEMA.match(/enum AssignmentStatus \{([^}]+)\}/)?.[1] ?? "";
    const values = enumBlock.split(/\s+/).filter(Boolean);
    // ‏QUESTION ירד ב-0.4 (אפיון §3.4): שאלה אינה סטטוס אלא הודעה בשרשור.
    // הרשימה נעולה בכוונה — ערך שנוסף בלי החלטה הוא בדיוק איך "בטיפול"
    // ו"לא יכול לקחת" היו מתגנבים פנימה.
    expect(values).toEqual(["SENT", "VIEWED", "DONE", "REMOVED"]);
    expect(SCHEMA).not.toMatch(/IN_PROGRESS|CANNOT_TAKE|REJECTED/);
  });

  it("SC-OUT-09 — אין service worker; העמידות היא שמירה מקומית בשיגור בלבד", () => {
    expect(source).not.toMatch(/serviceWorker\.register|next-pwa|workbox/i);
    // מה שכן קיים: טיוטה מקומית ב-IndexedDB.
    expect(source).toMatch(/offline-draft|indexedDB/i);
  });

  it("SC-OUT-10/DM-F21 — אין שדה תאריך יעד לתזכורת", () => {
    expect(SCHEMA).not.toMatch(/dueDate|reminderAt|deadline/i);
  });

  it("SC-OUT-11 — אין טבלת לוג ביקורת למחיקות", () => {
    expect(SCHEMA).not.toMatch(/model\s+AuditLog|model\s+DeletionLog/i);
  });

  it("SC-OUT-13/PROH-17 — אין איחוד אוטומטי של כפילויות", () => {
    // איחוד קיים כפעולה יזומה של מנהל המערכת בלבד.
    expect(source).toMatch(/mergeProfessionals/);
    expect(source).not.toMatch(/autoMerge|automaticMerge|dedupeAutomatically/i);
  });

  it("SC-OUT-14/PROH-18 — ההסלמה מסמנת בלבד; אין שיוך מחדש ואין הסלמה לדרג מעל", () => {
    const escalation = stripComments(
      readFileSync(join(SRC, "jobs", "handlers", "escalation.ts"), "utf8"),
    );
    expect(escalation).toMatch(/escalated:\s*true/);
    // אין נגיעה בשיוכים ואין התראה. ה-`enqueue` היחיד הוא תזמון עצמי של
    // הריצה הבאה (`JOB_TYPES.escalate`), ולא שיגור עבודה כלפי מישהו.
    expect(escalation).not.toMatch(/assignment/i);
    expect(escalation).not.toMatch(/JOB_TYPES\.notify|SEND_NOTIFICATION/);
    const enqueues = escalation.match(/enqueue\(/g) ?? [];
    expect(enqueues).toHaveLength(1);
    expect(escalation).toMatch(/enqueue\(db, JOB_TYPES\.escalate/);
  });

  it("SC-OUT-15/TC-01 — המערכת חד-דיירית: אין tenant בסכימה", () => {
    expect(SCHEMA).not.toMatch(/tenantId|organizationId|accountId/i);
  });

  it("PROH-05 — אין קריאה לסגירת פנייה מתוך ג׳וב או תזמון", () => {
    const jobs = sourceFiles(join(SRC, "jobs"))
      .map((file) => stripComments(readFileSync(file, "utf8")))
      .join("\n");
    expect(jobs).not.toMatch(/closeTicket|closedAt:\s*new Date/);
  });
});

describe("§3 — הסכימה תואמת את מודל המידע", () => {
  it("DM-F13 — ערוץ המקור הוא שלושת הערכים של האפיון", () => {
    const values = (SCHEMA.match(/enum Channel \{([^}]+)\}/)?.[1] ?? "")
      .split(/\s+/)
      .filter(Boolean);
    expect(values).toEqual(["SELF", "MANAGEMENT", "WHATSAPP"]);
  });

  it("PROH-13/DM-F18 — אין שדה סטטוס על הפנייה; הוא נגזר", () => {
    const ticket = SCHEMA.match(/model Ticket \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(ticket).not.toMatch(/^\s*status\s+/m);
    expect(ticket).toMatch(/closedAt\s+DateTime\?/);
  });

  it("DM-E06 — הסטטוס יושב על השיוך, וזהו המפלס שבו נרשמת המציאות", () => {
    const assignment = SCHEMA.match(/model Assignment \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(assignment).toMatch(/status\s+AssignmentStatus/);
    expect(assignment).toMatch(/statusChangedAt/);
  });

  it("DM-Q04 — אינדקסי pg_trgm שוחזרו, **ומוצהרים בסכימה** כדי שלא יימחקו שוב", () => {
    /**
     * **הבדיקה הזו התהפכה, וזה היה מתוכנן.**
     *
     * הניסוח הקודם קיבע פער: `20260722180000_search_trigram_indexes` יצרה
     * ארבעה אינדקסי GIN, ו-`20260724054950_add_rate_limit` — מיגרציה שכל
     * תוכנה היה הוספת טבלת `RateLimit` — מחקה את ארבעתם. ההערה שם אמרה
     * במפורש: "היא תיהפך לאדומה ברגע שמיגרציה חדשה תשחזר אותם, וזה בדיוק
     * הרגע לעדכן גם את התיעוד". זה הרגע.
     *
     * **מה שנבדק עכשיו אינו ה-SQL אלא ההצהרה.** ספירת `CREATE`/`DROP`
     * במיגרציות הייתה מקבעת את ההיסטוריה, והיא תמשיך להשתנות בכל מיגרציה
     * עתידית. מה שבאמת מונע חזרה של התקלה הוא שהאינדקסים מוצהרים
     * ב-`schema.prisma`: כל עוד הם חיים ב-SQL גולמי בלבד, ההשוואה של Prisma
     * מול בסיס הנתונים מסווגת אותם כעודפים ומוחקת אותם — בכל מיגרציה, בכל
     * נושא, בשקט.
     *
     * ‏`tests/integration/search-indexes.test.ts` בודק את הצד השני: שהם
     * באמת קיימים בבסיס הנתונים, ושה-`LC_CTYPE` שלו מאפשר ל-pg_trgm לחלץ
     * שלשות מעברית — פגם נפרד שההצהרה אינה מגינה מפניו.
     */
    const declarations =
      SCHEMA_RAW.match(/@@index\(\[[^\]]*gin_trgm_ops[^\]]*\],\s*type:\s*Gin\)/g) ?? [];

    expect(
      declarations.length,
      "ארבעת אינדקסי החיפוש חייבים להיות מוצהרים ב-schema.prisma " +
        "(Ticket.description, Message.text, MediaFile.transcription, MediaFile.extractedText). " +
        "אינדקס שאינו מוצהר נמחק בשקט על ידי המיגרציה הבאה — כפי שקרה ב-add_rate_limit.",
    ).toBe(4);

    // ...ושהשחזור אכן קיים כמיגרציה, ולא רק כהצהרה שמעולם לא הורצה.
    const migrations = join(process.cwd(), "prisma", "migrations");
    const files = sourceFilesRecursive(migrations, ".sql");
    const sql = files.map((file) => readFileSync(file, "utf8")).join("\n");

    const created = (sql.match(/CREATE INDEX[^;]*USING GIN[^;]*gin_trgm_ops/gi) ?? []).length;
    const dropped = (sql.match(/DROP INDEX[^;]*_trgm/gi) ?? []).length;

    expect(created - dropped, "נטו: ארבעה אינדקסי trgm חיים אחרי כל המיגרציות").toBe(4);
  });
});

/** גרסה של `sourceFiles` לסיומת שרירותית — המיגרציות אינן TypeScript */
function sourceFilesRecursive(dir: string, extension: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFilesRecursive(full, extension));
    else if (entry.endsWith(extension)) out.push(full);
  }
  return out;
}
