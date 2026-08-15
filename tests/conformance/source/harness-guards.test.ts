import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * אוכפי הארנס — בדיקות על **הבדיקות עצמן**.
 *
 * הפרויקט נכווה שלוש פעמים מאותו דפוס: טענה שנראית ירוקה מפני שהיא בודקת
 * את הדבר הלא נכון. פעם ראשונה — `toHaveCount(0)` תחת `<details>` סגור,
 * שנפתר לאפס אלמנטים כי הדפדפן מסיר תוכן מקופל מעץ הנגישות. פעם שנייה —
 * ‏`gotoNewTicket` שהיה מגודר ב-`isVisible()` ולכן דילג בשקט. פעם שלישית
 * היא הסיבה לקובץ הזה.
 *
 * הלקח שחוזר בכל שלוש: אין מי שיגלה טענה ריקה, כי היא **עוברת**. רק אוכף
 * שקורא את קוד הבדיקה תופס אותה.
 */

const SUITES = ["conformance/specs", "e2e", "prod-qa"];

/** לוקטורים שהם עמוד, כפי שהם נקראים בפועל בחבילות */
const PAGE_VAR = "[A-Za-z_][A-Za-z0-9_]*";

interface Offence {
  file: string;
  line: number;
  variable: string;
  filledAt: number;
  code: string;
}

function specFiles(): string[] {
  const files: string[] = [];
  for (const dir of SUITES) {
    const full = join(process.cwd(), dir);
    for (const name of readdirSync(full)) {
      if (name.endsWith(".spec.ts")) files.push(join(dir, name).replace(/\\/g, "/"));
    }
  }
  return files;
}

/**
 * מוצא טענות `getByText(V)` שבהן `V` הוא ערך שהוקלד זה עתה לאותו עמוד,
 * **בלי ניווט ביניהם**.
 *
 * למה דווקא הצירוף הזה: ‏`page.getByText(x)` מתאים גם `<textarea>` שערכו
 * ‏`x` — פלייררייט מתאים טקסט גם לערכי פקדים ולא רק לתוכן. לכן טענה כזו
 * אחרי `fill(x)` נפתרת **מיד עם ההקלדה** ולעולם אינה ממתינה לשרת, והצעד
 * שאחריה מתחרה בכתיבה שטרם נחתה. ניווט (`goto`/`reload`/התחברות) מרוקן
 * את הפקד ולכן מסיר את ההתנגשות — ואז הטענה לגיטימית.
 *
 * הפתרון הוא `threadMessage(page, text)`, שמצמצם ל-`listitem`.
 */
function findOffences(file: string): Offence[] {
  const lines = readFileSync(join(process.cwd(), file), "utf8").split(/\r?\n/);
  const filled = new Map<string, { page: string; line: number }>();
  const offences: Offence[] = [];

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith("//") || line.startsWith("*")) return;

    const fill = line.match(new RegExp(`\\b(${PAGE_VAR})\\.[^;]*\\.fill\\((${PAGE_VAR})\\)`));
    if (fill) filled.set(fill[2], { page: fill[1], line: index + 1 });

    // ניווט מרוקן את הפקד — מכאן ואילך הטענה על אותו משתנה שוב תקפה.
    const nav = line.match(
      new RegExp(`\\b(${PAGE_VAR})\\.(goto|reload)\\(|\\b(?:loginAs|loginAsManager|openPortalTicket)\\(\\s*(${PAGE_VAR})`),
    );
    if (nav) {
      const navigated = nav[1] ?? nav[2];
      for (const [variable, origin] of filled) {
        if (origin.page === navigated) filled.delete(variable);
      }
    }

    const assertion = line.match(new RegExp(`\\b(${PAGE_VAR})\\.getByText\\((${PAGE_VAR})[),]`));
    if (!assertion) return;
    const origin = filled.get(assertion[2]);
    if (origin && origin.page === assertion[1]) {
      offences.push({
        file,
        line: index + 1,
        variable: assertion[2],
        filledAt: origin.line,
        code: line,
      });
    }
  });

  return offences;
}

describe("אוכפי הארנס — טענה חייבת לבדוק את מה שהיא מתיימרת לבדוק", () => {
  it("HG-01 — אין טענת getByText על טקסט שהוקלד לאותו עמוד ולא נשלח דרך ניווט", () => {
    const offences = specFiles().flatMap(findOffences);

    const report = offences
      .map((o) => `${o.file}:${o.line} — getByText(${o.variable}) הוקלד בשורה ${o.filledAt}\n    ${o.code}`)
      .join("\n");

    expect(
      offences,
      `טענה שנפתרת על תיבת הכתיבה ולא על מה שהשרת החזיר — השתמש ב-threadMessage():\n${report}`,
    ).toHaveLength(0);
  });
});
