/**
 * מנפיק `GMAIL_REFRESH_TOKEN` — הרשאה חד-פעמית לשלוח בשם חשבון ה-Gmail.
 *
 * **למה זה נדרש בכלל.** נמדד מתוך הקונטיינר של הפרודקשן ב-7.9.2026:
 * Railway חוסם כל SMTP יוצא (25/465/587 נבלעים בשקט ל-8 שניות, בעוד ש-443
 * נענה ב-16ms). ערוץ המייל עבר לדבר עם Gmail מעל HTTPS, וזו ההרשאה שהוא
 * צריך — ראה `src/lib/notifier/gmail-api.ts`.
 *
 * **מה הסקריפט הזה אינו עושה:** הוא אינו נוגע בסיסמאות ואינו מבקש מהמשתמש
 * להדביק סוד. ההרשאה עוברת דרך זרימת ההסכמה של גוגל בדפדפן בלבד, והטוקן
 * שמודפס בסוף הוא מה שנכנס ל-`.env.local` ול-Railway Variables.
 *
 * הרצה:
 *   npx tsx scripts/gmail-oauth.mts
 *
 * דרישה חד-פעמית ב-Google Cloud Console, על אותו OAuth client שמשמש
 * להתחברות עם Google:
 *   1. להוסיף ל-Authorized redirect URIs את `http://localhost:5311/callback`
 *   2. להוסיף ל-OAuth consent screen את ה-scope
 *      `https://www.googleapis.com/auth/gmail.send`
 *
 * הוספת ה-scope אינה משנה דבר במסך ההתחברות של המערכת: ה-scopes שנשלחים
 * שם נקבעים בכתובת ההרשאה (`src/lib/google-oauth.ts`), לא ברישום הלקוח.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { config } from "dotenv";

// סדר הטעינה של Next: `.env.local` גובר על `.env`. הסקריפט חייב לקרוא את
// שניהם ובאותו סדר — המפתחות של גוגל יושבים ב-`.env.local` בלבד, ובלי זה
// הוא נכשל על "חסרים GOOGLE_CLIENT_ID" כשהם קיימים היטב.
config({ path: ".env.local" });
config();

const PORT = 5311;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

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
authUrl.searchParams.set("scope", SCOPE);
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

const body = (await response.json()) as { refresh_token?: string; error_description?: string };

if (!response.ok || !body.refresh_token) {
  console.error(`✖ החלפת הקוד נכשלה: ${body.error_description ?? response.status}`);
  console.error("  אם התקבל access_token בלי refresh_token — בטל את הגישה של האפליקציה");
  console.error("  ב-https://myaccount.google.com/permissions והרץ שוב.");
  process.exit(1);
}

console.log("\n✔ ההרשאה הונפקה. להוסיף כ-GMAIL_REFRESH_TOKEN ל-.env.local ול-Railway:\n");
console.log(body.refresh_token);
console.log("\nואז לאמת בפועל: npx tsx scripts/smoke-mail.mts <כתובת>");
