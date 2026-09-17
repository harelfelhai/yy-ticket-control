import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, sourceFiles, stripComments } from "../../unit/source-scan";

/**
 * §5.ה3 כלל 3 (EM-20) — **המערכת אינה משנה דבר בתיבת הדואר.**
 *
 * התיבה משותפת עם EasyInv, שמשתמש בסטטוס "לא נקרא" כרשימת העבודה שלו.
 * סימון כנקרא, העברה לתיקייה או מחיקה מצדנו היו מעלימים לו חשבונית בלי
 * שאיש יידע. הכלל נאכף בשתי שכבות, ושתיהן נבדקות כאן:
 *
 * 1. **ביכולת:** ההרשאה שמונפקת לתיבה היא `gmail.send` ו-`gmail.readonly`
 *    בלבד — טוקן כזה אינו יכול לשנות הודעה גם אם קוד ינסה.
 * 2. **בקוד:** שום קובץ שמדבר עם Gmail אינו קורא לפעולה משנה. בלי השכבה
 *    הזו, מישהו שירחיב את ההרשאה "כדי לנסות משהו" יגלה שהקוד כבר מוכן לזה.
 *
 * הסריקה היא על קוד המקור **בלי הערות**, כי ההערות כאן מסבירות במפורש מה
 * אסור ולמה.
 */

const SCRIPT = readFileSync(join(process.cwd(), "scripts", "gmail-oauth.mts"), "utf8");

/** כל קובץ ב-`src` שמדבר עם Gmail API, עם תוכנו בלי הערות */
function gmailFiles(): { path: string; code: string }[] {
  return sourceFiles(SRC)
    .map((file) => ({
      path: relative(SRC, file).replaceAll("\\", "/"),
      code: stripComments(readFileSync(file, "utf8")),
    }))
    .filter(({ code }) => /gmail\.googleapis\.com/.test(code));
}

describe("§5.ה3 כלל 3 — המערכת אינה משנה דבר בתיבה", () => {
  it("EM-20 — ההרשאה שמונפקת לתיבה היא שליחה וקריאה בלבד", () => {
    const block = SCRIPT.match(/const GMAIL_SCOPES = \[([\s\S]*?)\]/)?.[1] ?? "";
    const scopes = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    // ‏`gmail.modify`, `mail.google.com` (גישה מלאה) ו-`gmail.labels` הם
    // ההיקפים שמתירים שינוי — אף אחד מהם אינו מופיע בסקריפט כקוד.
    expect(stripComments(SCRIPT)).not.toMatch(/gmail\.modify|gmail\.labels|mail\.google\.com\/"|gmail\.insert/);
  });

  it("EM-20 — שום קובץ שמדבר עם Gmail אינו קורא לפעולה משנה", () => {
    const files = gmailFiles();
    // הכיוון החיובי: אם הערוץ יעבור לקובץ שהסריקה אינה מזהה, האיסור לא
    // ייבדק על ריק.
    expect(files.length).toBeGreaterThan(0);

    const violations = files.flatMap(({ path, code }) =>
      [
        /\/(modify|trash|untrash)\b/,
        /batchModify|batchDelete/,
        /addLabelIds|removeLabelIds/,
        /method:\s*["'](DELETE|PUT|PATCH)["']/,
        /\/messages\/import|\/messages\/insert|\/drafts\b|\/labels\b|\/filters\b/,
      ]
        .filter((pattern) => pattern.test(code))
        .map((pattern) => `${path} — ${pattern}`),
    );
    expect(violations).toEqual([]);
  });
});
