import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySignature } from "@/lib/whatsapp/signature";

/**
 * אימות `X-Hub-Signature-256` — אבטחת ה-webhook — על **גופים אמיתיים** מהספייק W0.
 *
 * החתימה האמיתית של Meta אינה נשמרת — היא תלויה ב-App Secret ובגוף המקורי,
 * שהוחלפו בפרטים מלאכותיים — ולכן כאן חותמים בסוד בדיקה. מה שנבדק הוא החוזה:
 * HMAC-SHA256 על **הבתים כפי שהגיעו**, בקידוד hex, אחרי `sha256=`.
 */

const SECRET = "test-app-secret";
const FIXTURES = join(process.cwd(), "tests", "fixtures", "whatsapp");

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, `${name}.json`));
}

function sign(body: Buffer | string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifySignature", () => {
  it.each(["text-report", "text-keyword-only", "image-caption", "voice", "status-failed", "meta-test-sample"])(
    "חתימה תקינה על הבתים כפי שהגיעו — %s",
    (name) => {
      const body = fixture(name);
      expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    },
  );

  it("עברית: הגוף כטקסט וכבתים נותן אותה חתימה (UTF-8)", () => {
    const body = fixture("text-keyword-only");
    expect(body.toString("utf8")).toContain("תקלה");
    expect(verifySignature(body.toString("utf8"), sign(body), SECRET)).toBe(true);
  });

  it("גוף שפוענח ל-JSON והוחזר לטקסט — אינו אותם בתים, והחתימה נכשלת", () => {
    const body = fixture("image-caption");
    const reserialized = JSON.stringify(JSON.parse(body.toString("utf8")));
    expect(verifySignature(reserialized, sign(body), SECRET)).toBe(false);
  });

  it("גוף שהשתנה בתו אחד נדחה", () => {
    const body = fixture("text-report");
    const tampered = Buffer.from(body.toString("utf8").replace("972500000002", "972500000009"), "utf8");
    expect(verifySignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("סוד שגוי נדחה", () => {
    const body = fixture("text-report");
    expect(verifySignature(body, sign(body, "other-secret"), SECRET)).toBe(false);
  });

  it("כותרת חסרה או ריקה נדחית, וגם סוד ריק", () => {
    const body = fixture("text-report");
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, "", SECRET)).toBe(false);
    expect(verifySignature(body, sign(body), "")).toBe(false);
  });

  it("כותרת בלי `sha256=` נדחית", () => {
    const body = fixture("text-report");
    expect(verifySignature(body, sign(body).slice("sha256=".length), SECRET)).toBe(false);
    expect(verifySignature(body, sign(body).replace("sha256=", "sha1="), SECRET)).toBe(false);
  });

  it("חתימה באורך שונה נדחית בלי לזרוק (timing-safe דורש אורך שווה)", () => {
    const body = fixture("text-report");
    expect(() => verifySignature(body, `${sign(body)}00`, SECRET)).not.toThrow();
    expect(verifySignature(body, `${sign(body)}00`, SECRET)).toBe(false);
    expect(verifySignature(body, sign(body).slice(0, -2), SECRET)).toBe(false);
  });

  it("תווים שאינם hex נדחים; אותיות גדולות מתקבלות", () => {
    const body = fixture("text-report");
    const valid = sign(body);
    expect(verifySignature(body, `${valid.slice(0, -1)}g`, SECRET)).toBe(false);
    expect(verifySignature(body, `sha256=${valid.slice("sha256=".length).toUpperCase()}`, SECRET)).toBe(true);
  });
});
