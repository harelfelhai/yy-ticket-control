/**
 * מנפיק `GMAIL_REFRESH_TOKEN` — הרשאה חד-פעמית לשלוח **ולקרוא** בשם חשבון
 * ה-Gmail של המערכת.
 *
 * **למה נדרשת שליחה.** נמדד מתוך הקונטיינר של הפרודקשן ב-7.9.2026: Railway
 * חוסם כל SMTP יוצא (25/465/587 נבלעים בשקט ל-8 שניות, בעוד ש-443 נענה
 * ב-16ms). ערוץ המייל עבר לדבר עם Gmail מעל HTTPS — ראה
 * `src/lib/notifier/gmail-api.ts`.
 *
 * **למה נדרשת קריאה (אפיון 1.3).** פתיחת פנייה במייל קוראת את התיבה.
 * ההיקף הוא `gmail.readonly` ולא `gmail.modify`, וזו הכרעה ולא חיסכון: §5.ה3
 * כלל 3 קובע שהמערכת אינה משנה דבר בתיבה, כי EasyInv — שחולק איתה את התיבה
 * — משתמש בסטטוס "לא נקרא" כרשימת העבודה שלו. הרשאה שאינה מאפשרת שינוי
 * אוכפת את הכלל ביכולת ולא במשמעת. `tests/conformance/source/email-intake.test.ts`
 * מוודא שהרשימה כאן היא בדיוק שני ההיקפים האלה.
 *
 * **מה הסקריפט אינו עושה:** הוא אינו נוגע בסיסמאות ואינו מבקש להדביק סוד.
 * ההרשאה עוברת דרך זרימת ההסכמה של גוגל בדפדפן, והטוקן **נכתב ישירות
 * ל-`.env.local`** — לא לטרמינל, כדי שלא יישאר בהיסטוריה של המסוף או של
 * שיחה. `--print` מחזיר את ההתנהגות הקודמת (הדפסה) למי שצריך אותה.
 *
 * הרצה:
 *   npx tsx scripts/gmail-oauth.mts                 # כותב GMAIL_REFRESH_TOKEN
 *   npx tsx scripts/gmail-oauth.mts --var NAME      # כותב למשתנה אחר (למשל חשבון בדיקות)
 *   npx tsx scripts/gmail-oauth.mts --print         # מדפיס במקום לכתוב
 *
 * **להתחבר בדפדפן כחשבון התיבה עצמה.** הטוקן הוא הרשאה של החשבון שאישר;
 * אישור מחשבון אחר ייתן למערכת גישה לתיבה הלא נכונה. הסקריפט מדפיס את
 * כתובת החשבון שאישר ומשווה אותה ל-`GMAIL_USER` כשהוא מוגדר.
 *
 * דרישה חד-פעמית ב-Google Cloud Console, על אותו OAuth client שמשמש
 * להתחברות עם Google:
 *   1. להוסיף ל-Authorized redirect URIs את `http://localhost:5311/callback`
 *   2. להוסיף ל-OAuth consent screen (Data access) את שני ה-scopes שלמטה
 *
 * הוספת ה-scopes אינה משנה את מסך ההתחברות של המערכת: ה-scopes שנשלחים שם
 * נקבעים בכתובת ההרשאה (`src/lib/google-oauth.ts`), לא ברישום הלקוח.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";

// סדר הטעינה של Next: `.env.local` גובר על `.env`. הסקריפט חייב לקרוא את
// שניהם ובאותו סדר — המפתחות של גוגל יושבים ב-`.env.local` בלבד, ובלי זה
// הוא נכשל על "חסרים GOOGLE_CLIENT_ID" כשהם קיימים היטב.
config({ path: ".env.local" });
config();

const PORT = 5311;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const ENV_FILE = ".env.local";

/** שני ההיקפים — ולא אחד יותר. ראה את ההערה בראש הקובץ. */
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

const args = process.argv.slice(2);
const print = args.includes("--print");
const varIndex = args.indexOf("--var");
const varName = varIndex >= 0 ? args[varIndex + 1] : "GMAIL_REFRESH_TOKEN";

if (!varName || !/^[A-Z][A-Z0-9_]*$/.test(varName)) {
  console.error("✖ --var דורש שם משתנה באותיות גדולות, למשל GMAIL_TEST_REFRESH_TOKEN");
  process.exit(1);
}

const clientId = process.env["GOOGLE_CLIENT_ID"];
const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];

if (!clientId || !clientSecret) {
  console.error("✖ חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. ראה .env.example");
  process.exit(1);
}

/**
 * `prompt=consent` **חובה ואינו מיותר.** גוגל מחזירה `refresh_token` רק
 * בהסכמה ראשונה; חשבון שכבר אישר את האפליקציה בעבר יקבל `access_token`
 * בלבד, והסקריפט היה מסתיים בהצלחה מדומה בלי הטוקן שבשבילו הוא קיים.
 */
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", GMAIL_SCOPES.join(" "));
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

/**
 * פותח כתובת בדפדפן ברירת המחדל של Windows.
 *
 * **המרכאות סביב הכתובת אינן קישוט.** `cmd.exe` מפרש `&` כמפריד פקודות,
 * וכתובת ההרשאה של גוגל בנויה כולה מפרמטרים מופרדים ב-`&`. Node אינו
 * עוטף במרכאות ארגומנט שאין בו רווח, ולכן `cmd /c start "" <url>` העביר
 * לדפדפן את `...?client_id=...` בלבד — וגוגל ענתה
 * `Required parameter is missing: response_type`, שגיאה שנראית כמו תקלת
 * הגדרות ואינה כזו. `windowsVerbatimArguments` מוסר את הציטוט האוטומטי של
 * Node כדי שהמרכאות שכתובות כאן יגיעו ל-cmd כפי שהן.
 *
 * הארגומנט הריק אחרי `start` הוא כותרת החלון: בלעדיו `start` היה מפרש את
 * המחרוזת המצוטטת הראשונה ככותרת ולא פותח דבר.
 */
function openInBrowser(url: string): void {
  spawn("cmd", ["/c", "start", '""', `"${url}"`], {
    stdio: "ignore",
    detached: true,
    windowsVerbatimArguments: true,
  }).unref();
}

/**
 * מחליף או מוסיף שורת `NAME=value` ב-`.env.local`, בלי לגעת בשאר הקובץ.
 * הערך אינו עובר דרך המסוף בשום שלב.
 */
function writeEnvVar(name: string, value: string): void {
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = pattern.test(current)
    ? current.replace(pattern, () => line)
    : `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${line}\n`;
  writeFileSync(ENV_FILE, next, "utf8");
}

const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }

    const received = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:system-ui;padding:2rem">${
        received ? "ההרשאה התקבלה. אפשר לסגור את החלון ולחזור לטרמינל." : `ההרשאה נכשלה: ${error}`
      }</body>`,
    );

    server.close();
    if (received) resolve(received);
    else reject(new Error(`גוגל החזירה שגיאה: ${error}`));
  });

  server.listen(PORT, () => {
    console.log("פותח את הדפדפן לאישור ההרשאה…");
    console.log(`אם הוא לא נפתח, פתח ידנית:\n${authUrl}\n`);
    openInBrowser(authUrl.toString());
  });
});

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  }),
});

const body = (await response.json()) as {
  refresh_token?: string;
  access_token?: string;
  scope?: string;
  error_description?: string;
};

if (!response.ok || !body.refresh_token) {
  console.error(`✖ החלפת הקוד נכשלה: ${body.error_description ?? response.status}`);
  console.error("  אם התקבל access_token בלי refresh_token — בטל את הגישה של האפליקציה");
  console.error("  ב-https://myaccount.google.com/permissions והרץ שוב.");
  process.exit(1);
}

/**
 * **מסך ההסכמה של גוגל מאפשר לבטל סימון של היקף בודד**, וההסכמה עדיין
 * "מצליחה". טוקן בלי `gmail.readonly` היה נכתב, השליחה הייתה ממשיכה לעבוד,
 * והקליטה הייתה נכשלת רק בסבב הראשון — ובפרודקשן. לכן ההיקפים שהוענקו
 * בפועל נבדקים כאן, והטוקן אינו נכתב אם חסר אחד מהם.
 */
const granted = new Set((body.scope ?? "").split(/\s+/).filter(Boolean));
const missing = GMAIL_SCOPES.filter((scope) => !granted.has(scope));
if (missing.length > 0) {
  console.error(`✖ ההרשאה הוענקה בלי: ${missing.join(", ")}`);
  console.error("  במסך ההסכמה יש לסמן את כל ההרשאות. הטוקן לא נכתב. הרץ שוב.");
  process.exit(1);
}

// איזה חשבון אישר בפועל — הטעות הצפויה היא דפדפן שמחובר לחשבון אחר.
const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
  headers: { authorization: `Bearer ${body.access_token}` },
});
const profile = (await profileResponse.json()) as { emailAddress?: string };
const mailbox = profile.emailAddress ?? "(לא ידוע)";
const expected = process.env["GMAIL_USER"];

console.log(`\n✔ ההרשאה הונפקה לחשבון ${mailbox}, עם ${GMAIL_SCOPES.length} ההיקפים.`);
if (expected && expected.trim().toLowerCase() !== mailbox.toLowerCase()) {
  console.warn(`⚠ GMAIL_USER מוגדר ל-${expected}, אבל ההרשאה ניתנה ל-${mailbox}.`);
  console.warn("  אם זו לא הכוונה — התחבר בדפדפן לחשבון הנכון והרץ שוב.");
}

if (print) {
  console.log(`\n${varName}:\n${body.refresh_token}`);
} else {
  writeEnvVar(varName, body.refresh_token);
  console.log(`\nנכתב ל-${ENV_FILE} כ-${varName} (הערך אינו מודפס).`);
  console.log("לפרודקשן: להעתיק את הערך מהקובץ ל-Railway Variables.");
}
console.log("\nלאימות: npx tsx scripts/smoke-mail.mts <כתובת>");
