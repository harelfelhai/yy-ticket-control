import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { BRAND_BACKGROUND, BRAND_COLOR } from "@/lib/brand";
import { he } from "@/lib/he";

/**
 * ה-manifest הוא config כמעט-סטטי, אבל יש לו **חוזה התקנה**: Chrome באנדרואיד
 * לא יציע "הוסף למסך הבית" בלי אייקון 192 ואייקון 512, ו-manifest שמצביע על
 * קובץ אייקון חסר או בגודל שגוי נכשל בשקט — האייקון פשוט לא מופיע. הבדיקה
 * מקבעת את החוזה הזה: השדות קיימים, וכל אייקון מוצהר קיים בפועל בגודל שהוצהר.
 */

const root = process.cwd();

/** קורא רוחב/גובה מכותרת ה-IHDR של PNG, בלי תלות בספריית תמונות. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (buf[i] !== signature[i]) throw new Error(`${file} אינו PNG תקין`);
  }
  // ‏IHDR בא מיד אחרי החתימה: 4 בייט אורך + 4 בייט "IHDR", ואז רוחב וגובה.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("manifest", () => {
  const m = manifest();

  it("מכיל את שדות ההתקנה הנדרשים, מתוך מקור אמת אחד", () => {
    expect(m.name).toBe(he.app.title);
    expect(m.short_name).toBe(he.app.name);
    expect(m.description).toBe(he.app.description);
    expect(m.start_url).toBe("/board");
    expect(m.display).toBe("standalone");
    expect(m.dir).toBe("rtl");
    expect(m.lang).toBe("he");
    expect(m.theme_color).toBe(BRAND_COLOR);
    expect(m.background_color).toBe(BRAND_BACKGROUND);
  });

  it("מצהיר על אייקוני 192 ו-512 (קריטריון ההתקנה) ועל אייקון maskable", () => {
    const icons = m.icons ?? [];
    const any = icons.filter((i) => i.purpose === "any" || i.purpose === undefined);
    expect(any.some((i) => i.sizes === "192x192")).toBe(true);
    expect(any.some((i) => i.sizes === "512x512")).toBe(true);
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("כל אייקון שמוצהר קיים בפועל ובגודל שהוצהר", () => {
    const icons = m.icons ?? [];
    expect(icons.length).toBeGreaterThan(0);

    for (const icon of icons) {
      // הכתובות מוחלטות ("/icons/…"), ו-Next מגיש את `public/` מהשורש.
      const file = path.join(root, "public", String(icon.src));
      expect(existsSync(file), `${icon.src} חסר`).toBe(true);

      const { width, height } = pngSize(file);
      const [w, h] = String(icon.sizes).split("x").map(Number);
      expect({ src: icon.src, width, height }).toEqual({ src: icon.src, width: w, height: h });
    }
  });

  it("קיים apple-icon בגודל 180 לנתיב ה-iOS (שאינו קורא את ה-manifest)", () => {
    // ‏iOS אינו משתמש באייקוני ה-manifest אלא ב-apple-touch-icon; ‏Next מייצר
    // את הקישור מקובץ `src/app/apple-icon.png`. אם הוא נמחק, iOS ייפול חזרה
    // לצילום מסך של הדף — לכן מאמתים במפורש שהוא קיים ובגודל הנכון.
    const apple = path.join(root, "src/app/apple-icon.png");
    expect(existsSync(apple), "apple-icon.png חסר").toBe(true);
    expect(pngSize(apple)).toEqual({ width: 180, height: 180 });
  });
});
