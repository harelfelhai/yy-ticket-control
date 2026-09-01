import { chromium } from "@playwright/test";

/**
 * מודד את זמן החלפת-מסנן בלוח כפי שמשתמש מחובר חווה אותו: מרגע בחירת אתר
 * ועד שתשובת השרת (ה-RSC של הכתובת החדשה) הגיעה והמסך צויר.
 *
 * שימוש: npx tsx scripts/measure-board.mts
 *   MEASURE_BASE_URL   ברירת מחדל http://localhost:3100
 *   MEASURE_IDENTIFIER ברירת מחדל 0500000000  (האדמין של seed-demo)
 *   SEED_ADMIN_PASSWORD ברירת מחדל dev-admin-1234 (כמו ב-seed-demo)
 *
 * הפרוטוקול: התחברות פעם אחת, 2 חימומים, 5 דגימות לסירוגין בין שני אתרים.
 * מדווח כל דגימה + חציון. נכתב לצורך אבחון הביצועים של 27.8.2026 ונשאר
 * ככלי מדידה קבוע — להריץ לפני ואחרי כל שינוי שנוגע בזמן הלוח.
 */

const BASE = process.env["MEASURE_BASE_URL"] ?? "http://localhost:3100";
const IDENTIFIER = process.env["MEASURE_IDENTIFIER"] ?? "0500000000";
const PASSWORD = process.env["SEED_ADMIN_PASSWORD"] ?? "dev-admin-1234";

const WARMUPS = 2;
const SAMPLES = 5;

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${BASE}/login`);
  await page.fill('input[name="identifier"]', IDENTIFIER);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/board**", { timeout: 30_000 });

  const siteSelect = page.getByLabel("אתר");
  const values = await siteSelect
    .locator("option")
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  if (values.length < 2) {
    console.error(`נדרשים לפחות שני אתרים בבסיס הנתונים; נמצאו ${values.length}.`);
    await browser.close();
    process.exit(1);
  }

  const [siteA, siteB] = values;

  /** בוחר אתר וממתין לתשובת ה-RSC של הכתובת החדשה + ציור מסגרת. */
  const change = async (value: string): Promise<number> => {
    const start = performance.now();
    const response = page.waitForResponse(
      (r) => r.url().includes("/board") && r.url().includes(`site=${value}`),
      { timeout: 60_000 },
    );
    await siteSelect.selectOption(value);
    await response;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    return performance.now() - start;
  };

  for (let i = 0; i < WARMUPS; i++) await change(i % 2 === 0 ? siteA : siteB);

  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const ms = await change(i % 2 === 0 ? siteA : siteB);
    times.push(ms);
    console.log(`דגימה ${i + 1}: ${Math.round(ms)}ms`);
  }

  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  console.log(`חציון החלפת-מסנן: ${Math.round(median)}ms  (${BASE})`);

  await browser.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
