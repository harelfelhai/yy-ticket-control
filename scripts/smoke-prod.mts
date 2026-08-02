import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * אימות פריסה — קריאה בלבד מול השרת החי.
 *
 * **הבעיה שזה פותר, ושקרתה בפועל.** הפריסה כאן ידנית ואינה מופעלת מ-push,
 * ולכן `main` יכול להיות ירוק, נקי ודחוף — בזמן שהאתר החי מריץ קוד מלפני
 * שלושה ימים. אף בדיקה בפרויקט לא הייתה נכשלת: כולן רצות מול בנייה מקומית.
 * מה שנחסר היה בדיקה שמשווה את **מה שמוגש** למה שכתוב בריפו.
 *
 * הסקריפט מבצע בקשות GET בלבד. הוא אינו כותב לבסיס הנתונים, אינו מתחבר,
 * ואינו שולח דבר — ולכן מותר להריץ אותו על פרודקשן בכל עת.
 *
 * הרצה: `npm run smoke:prod` (או עם כתובת אחרת: `npm run smoke:prod -- <url>`)
 */

const BASE =
  process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "https://web-production-6875c.up.railway.app";

const failures: string[] = [];
const notes: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) notes.push(`  ok   ${name}`);
  else failures.push(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

async function get(path: string, redirect: RequestRedirect = "manual") {
  const response = await fetch(`${BASE}${path}`, { redirect, headers: { "cache-control": "no-cache" } });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

console.log(`אימות פריסה מול ${BASE}\n`);

// ── 1. השרת חי ────────────────────────────────────────────────────────────
{
  const health = await get("/api/health");
  check("‏/api/health מחזיר 200", health.status === 200, `סטטוס ${health.status}`);
  check("‏/api/health מדווח ok", health.body.includes('"ok"'), health.body.slice(0, 80));
}

// ── 2. מסך ההתחברות מוגש שלם ──────────────────────────────────────────────
const login = await get("/login");
check("‏/login מחזיר 200", login.status === 200, `סטטוס ${login.status}`);
check("‏/login הוא RTL בעברית", /lang="he"[^>]*dir="rtl"|dir="rtl"[^>]*lang="he"/.test(login.body));

// ── 3. הגנת המסכים הפנימיים לא נשברה ──────────────────────────────────────
{
  const board = await get("/board");
  const location = board.headers.get("location") ?? "";
  check(
    "‏/board מפנה למסך ההתחברות ולא קורס",
    board.status >= 300 && board.status < 400 && location.includes("/login"),
    `סטטוס ${board.status}, יעד ${location || "—"}`,
  );
  check("ההפניה שומרת את היעד המקורי", location.includes("next="), location || "—");
}

// ── 4. פורטל עם קישור לא תקף אינו 500 ─────────────────────────────────────
{
  const portal = await get("/p/not-a-real-token-000000", "follow");
  check("קישור פורטל שגוי מטופל ואינו שגיאת שרת", portal.status < 500, `סטטוס ${portal.status}`);
}

// ── 5. הגרסה המוגשת היא זו שבריפו ─────────────────────────────────────────
/**
 * **הבדיקה המרכזית.** ‏`globals.css` הוא מקור האמת לטוקני הצבע, והוא משתנה
 * עם כל כיול פלטה. אם ה-CSS החי נושא ערך אחר — הפריסה ישנה.
 *
 * ההשוואה היא על החיתוך ולא על הקבוצה המלאה: Tailwind פולט רק טוקנים
 * שנמצאים בשימוש, וטוקן שלא נפלט אינו סתירה. מה שכן נפלט **חייב** להתאים.
 */
{
  /**
   * ‏`#ffffff` נפלט מהמזער כ-`#fff`. בלי הנרמול הזה שני טוקנים לבנים דווחו
   * כסטייה בהרצה הראשונה — תוצאת שווא שהייתה מרעילה את הבדיקה כולה.
   */
  const normalize = (hex: string) => {
    const value = hex.toLowerCase();
    return value.length === 4 ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : value;
  };

  const source = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const expected = new Map<string, string>();
  for (const [, name, value] of source.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    expected.set(name, normalize(value));
  }
  check("נמצאו טוקני צבע ב-globals.css", expected.size > 0, `${expected.size} טוקנים`);

  const hrefs = [...login.body.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
  check("מסך ההתחברות מקשר לגיליון סגנון", hrefs.length > 0);

  let served = "";
  for (const href of hrefs) served += (await get(href)).body;

  let compared = 0;
  const drifted: string[] = [];
  for (const [name, value] of expected) {
    const match = served.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`));
    if (!match) continue;
    compared += 1;
    if (normalize(match[1]) !== value) drifted.push(`${name}: חי ${match[1]} מול ${value} בקוד`);
  }

  check("נמצאו טוקנים להשוואה ב-CSS המוגש", compared > 0, `${compared} הושוו`);
  check(
    `הפלטה המוגשת זהה לזו שבריפו (${compared} טוקנים)`,
    drifted.length === 0,
    drifted.join("; "),
  );
}

// ── 6. נכסי ה-PWA ─────────────────────────────────────────────────────────
for (const asset of ["/manifest.webmanifest", "/icon.svg"]) {
  const result = await get(asset);
  check(`‏${asset} מוגש`, result.status === 200, `סטטוס ${result.status}`);
}

// ── סיכום ─────────────────────────────────────────────────────────────────
console.log(notes.join("\n"));
if (failures.length > 0) {
  console.error(`\n${failures.join("\n")}`);
  console.error(`\n${failures.length} כשלים מתוך ${failures.length + notes.length} בדיקות.`);
  process.exit(1);
}
console.log(`\nכל ${notes.length} הבדיקות עברו.`);
