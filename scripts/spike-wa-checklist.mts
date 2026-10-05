/**
 * דף עזר לספייק וואטסאפ (W0): רשימת ההודעות שצריך לשלוח למספר הבדיקה, עם
 * כפתור שפותח את WhatsApp Web בצ'אט הנכון — ובהודעות טקסט גם עם הטקסט מוכן.
 *
 * **למה דף ולא פתיחה ישירה מהטרמינל.** פתיחה של קישור מהטרמינל פותחת לשונית
 * חדשה בכל פעם, ו-WhatsApp Web מתיר לשונית פעילה אחת בלבד ("WhatsApp פתוח
 * בחלון אחר"). בדף, כל הכפתורים פותחים את אותה לשונית בשם קבוע.
 *
 * **המספר אינו כתוב בקוד** — הריפו ציבורי. הסקריפט שואל את Meta מה המספר של
 * `WHATSAPP_DEV_PHONE_NUMBER_ID`, בטוקן שב-`.env.local`, או מקבל `--to`.
 *
 * הרצה:
 *   npx tsx scripts/spike-wa-checklist.mts [--to 15551234567] [--no-open]
 *
 * הדף נכתב ל-`.wa-spike/checklist.html` (ב-gitignore) ונפתח בדפדפן.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const GRAPH_VERSION = process.env["WHATSAPP_GRAPH_VERSION"] || "v25.0";
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** שלב אחד ברשימה. `text` — יוכנס לתיבת ההודעה; `copy` — כפתור העתקה (כיתוב לתמונה) */
interface Step {
  id: string;
  title: string;
  checks: string;
  how: string;
  text?: string;
  copy?: string;
  /** אי אפשר לבצע מ-WhatsApp Web — רק מהטלפון */
  phoneOnly?: boolean;
}

const STEPS: Step[] = [
  {
    id: "א",
    title: "טקסט עם מילת המפתח",
    checks: "הודעה רגילה, ומבנה ה-from",
    how: "הכפתור פותח את הצ'אט עם הטקסט מוכן. לוחצים Enter כדי לשלוח.",
    text: "תקלה בדירה 12 — נזילה במטבח",
  },
  {
    id: "ב",
    title: "תמונה עם כיתוב",
    checks: "כיתוב ומזהה מדיה",
    how: "פותחים את הצ'אט, 📎 ← תמונות, בוחרים תמונה כלשהי, מדביקים את הכיתוב ושולחים.",
    copy: "תקלה",
  },
  {
    id: "ג",
    title: "הקלטה קולית",
    checks: "audio/ogg, ובדיקת המילה בתמלול",
    how: "פותחים את הצ'אט, לוחצים על המיקרופון ואומרים: \"יש תקלה בדירה 7, אין חשמל בסלון\". שולחים.",
  },
  {
    id: "ד",
    title: "קובץ PDF",
    checks: "מסמך ושם קובץ",
    how: "פותחים את הצ'אט, 📎 ← מסמך, בוחרים PDF קטן כלשהו ושולחים.",
  },
  {
    id: "ה",
    title: "סטיקר",
    checks: "סוג שלא נקלט",
    how: "פותחים את הצ'אט, 😊 ← סטיקרים, ושולחים סטיקר כלשהו.",
  },
  {
    id: "ו",
    title: "תגובת אימוג'י",
    checks: "reaction",
    how: "בצ'אט, מעבירים את העכבר על הודעת הבדיקה שמספר הבדיקה שלח לך בעבר ובוחרים אימוג'י.",
  },
  {
    id: "ז",
    title: "מיקום",
    checks: "סוג שלא נקלט",
    how: "WhatsApp Web אינו שולח מיקום. מהטלפון: פותחים את אותו צ'אט, 📎 ← מיקום ← שליחת המיקום הנוכחי.",
    phoneOnly: true,
  },
  {
    id: "ח",
    title: "העברה (Forward)",
    checks: "הסימון forwarded",
    how: "בצ'אט אחר כלשהו בוחרים הודעה, ← העבר, ובוחרים את הצ'אט עם מספר הבדיקה.",
  },
  {
    id: "ט",
    title: "עריכת הודעה א'",
    checks: "האם מגיע אירוע עריכה",
    how: "בצ'אט, על הודעה א': תפריט ההודעה ← עריכה, משנים ל\"תקלה בדירה 12 — נזילה גדולה במטבח\" ושומרים. אפשר לערוך עד 15 דקות אחרי השליחה.",
  },
];

/** המספר לשליחה, בספרות בלבד — מ-`--to`, או מ-Meta לפי מזהה מספר הבדיקה */
async function targetNumber(): Promise<string> {
  const explicit = flag("--to");
  if (explicit) return explicit.replace(/\D/g, "");

  const token = process.env["WHATSAPP_DEV_ACCESS_TOKEN"];
  const phoneNumberId = process.env["WHATSAPP_DEV_PHONE_NUMBER_ID"];
  if (!token || !phoneNumberId) {
    console.error("✖ אין --to, וחסרים WHATSAPP_DEV_ACCESS_TOKEN / WHATSAPP_DEV_PHONE_NUMBER_ID ב-.env.local");
    process.exit(1);
  }
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=display_phone_number`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body = (await response.json()) as { display_phone_number?: string; error?: { message?: string } };
  if (!response.ok || !body.display_phone_number) {
    console.error(`✖ Meta לא החזירה את המספר (HTTP ${response.status}): ${body.error?.message ?? "בלי פירוט"}`);
    console.error("  אם הטוקן הזמני פג — ליצור חדש ב-Step 1. Try it out, או להריץ עם --to.");
    process.exit(1);
  }
  return body.display_phone_number.replace(/\D/g, "");
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * `encodeURIComponent` ולא `URLSearchParams`: האחרון מקודד רווח כ-`+`, ולא
 * מובטח ש-WhatsApp Web מפענח `+` כרווח. `%20` מפוענח כרווח בכל מקרה.
 */
function chatUrl(number: string, text?: string): string {
  const base = `https://web.whatsapp.com/send?phone=${number}`;
  return text ? `${base}&text=${encodeURIComponent(text)}` : base;
}

function renderStep(step: Step, number: string): string {
  const open = step.phoneOnly
    ? `<span class="phone">מהטלפון בלבד</span>`
    : `<a class="button" target="wa-spike" rel="noopener" href="${escapeHtml(chatUrl(number, step.text))}">${step.text ? "פתח עם הטקסט" : "פתח את הצ'אט"}</a>`;
  const copy = step.copy
    ? `<button type="button" class="button secondary" data-copy="${escapeHtml(step.copy)}">העתק כיתוב: ${escapeHtml(step.copy)}</button>`
    : "";
  return `
    <li class="step" data-id="${step.id}">
      <label class="done"><input type="checkbox" data-step="${step.id}"> <span class="letter">${step.id}</span></label>
      <div class="body">
        <h2>${escapeHtml(step.title)}</h2>
        <p class="checks">בודק: ${escapeHtml(step.checks)}</p>
        <p>${escapeHtml(step.how)}</p>
        ${step.text ? `<p class="text">הטקסט: <bdi>${escapeHtml(step.text)}</bdi></p>` : ""}
        <div class="actions">${open}${copy}</div>
      </div>
    </li>`;
}

function renderPage(number: string): string {
  const display = `+${number}`;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ספייק וואטסאפ — הודעות לשליחה</title>
<style>
  :root { --bg: #f6f7f9; --card: #ffffff; --ink: #1d2433; --muted: #5b6475; --line: #dde1e8; --accent: #1f7a4d; --accent-ink: #ffffff; --warn: #8a5300; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 "Segoe UI", Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .lead { color: var(--muted); margin: 0 0 20px; }
  .lead bdi { color: var(--ink); font-weight: 600; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .step { display: flex; gap: 12px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .step.is-done { opacity: .55; }
  .done { display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; }
  .done input { width: 20px; height: 20px; }
  .letter { font-weight: 700; font-size: 18px; }
  .body { flex: 1; min-width: 0; }
  h2 { font-size: 17px; margin: 0; }
  .checks { color: var(--muted); font-size: 14px; margin: 2px 0 8px; }
  .text bdi { font-weight: 600; }
  p { margin: 0 0 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .button { display: inline-block; border: 0; border-radius: 8px; padding: 9px 14px; min-height: 40px; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }
  .button.secondary { background: #e8f3ed; color: var(--accent); }
  .phone { color: var(--warn); font-weight: 600; }
  .finish { margin-top: 20px; color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>ספייק וואטסאפ — הודעות לשליחה</h1>
  <p class="lead">היעד: מספר הבדיקה <bdi dir="ltr">${escapeHtml(display)}</bdi>. כל הכפתורים פותחים את WhatsApp Web באותה לשונית. ההודעה נשלחת רק כשלוחצים Enter שם — הקישור רק מכין אותה.</p>
  <ol>${STEPS.map((step) => renderStep(step, number)).join("")}
  </ol>
  <p class="finish">כשסיימת — לכתוב "סיימתי" בשיחה עם Claude.</p>
</main>
<script>
  // סימון "בוצע" נשמר בדפדפן הזה בלבד. בלי גישה לאחסון — הדף עובד בלעדיו.
  const KEY = "wa-spike-checklist";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const write = (state) => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
  const state = read();
  for (const box of document.querySelectorAll("input[data-step]")) {
    const id = box.dataset.step;
    const item = box.closest(".step");
    box.checked = Boolean(state[id]);
    item.classList.toggle("is-done", box.checked);
    box.addEventListener("change", () => {
      state[id] = box.checked;
      item.classList.toggle("is-done", box.checked);
      write(state);
    });
  }
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const label = button.textContent;
      try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = "הועתק ✓"; }
      catch { button.textContent = "ההעתקה נחסמה — להקליד ידנית"; }
      setTimeout(() => { button.textContent = label; }, 1800);
    });
  }
</script>
</body>
</html>
`;
}

function openInBrowser(path: string): void {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  spawn(command, commandArgs, { detached: true, stdio: "ignore" }).unref();
}

const number = await targetNumber();
const dir = ".wa-spike";
mkdirSync(dir, { recursive: true });
const file = resolve(join(dir, "checklist.html"));
writeFileSync(file, renderPage(number), "utf8");
console.log(`הדף נכתב: ${file}`);
console.log(`היעד: +${number} · ${STEPS.length} שלבים`);
if (!args.includes("--no-open")) openInBrowser(file);
