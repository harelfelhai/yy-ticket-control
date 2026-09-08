/**
 * הרצה בפועל של ערוץ המייל — בלי DB ובלי ליצור פנייה.
 *
 * ‏`smoke-notify` בודק את הצינור המלא, ולכן הוא **כותב**: יוצר קבלן ופנייה.
 * מול פרודקשן זה מזהם את בסיס הנתונים. כאן נבדק רק מה ש-`smoke-notify`
 * אינו יכול לבדוק בנפרד — שהאימות מול Gmail עובר ושההודעה יוצאת.
 *
 * הרצה מול פרודקשן, בלי לחשוף את הסוד:
 *   railway run --service web -- npx tsx scripts/smoke-mail.mts
 *
 * `railway run` מזריק את משתני הסביבה לתהליך הבן. הסוד אינו מודפס
 * ואינו נכתב לשום מקום.
 *
 * הרצה מקומית:
 *   npx tsx scripts/smoke-mail.mts <כתובת>
 */

// סדר הטעינה של Next: `.env.local` גובר על `.env`. בלי זה הסקריפט עבד רק
// תחת `railway run` — שמזריק את הסביבה בעצמו — ומקומית טען כאילו הערוץ
// אינו מוגדר, אף שההגדרות יושבות ב-`.env.local`. dotenv אינו דורס משתנה
// קיים, ולכן ערכי הפרודקשן ממשיכים לגבור תחת `railway run`.
const { config } = await import("dotenv");
config({ path: ".env.local" });
config();

const { selectEmailTransport, isEmailConfigured } = await import("../src/lib/notifier/email");
const { env } = await import("../src/lib/env");

const to = process.argv[2] ?? env.gmailUser();

if (!isEmailConfigured()) {
  console.error(
    "✖ ערוץ המייל אינו מוגדר: נדרש GMAIL_USER, ולצדו GMAIL_REFRESH_TOKEN (מומלץ) או GMAIL_APP_PASSWORD",
  );
  process.exit(1);
}
if (!to) {
  console.error("✖ אין נמען. העבר כתובת כארגומנט, או הגדר GMAIL_USER");
  process.exit(1);
}

const transport = selectEmailTransport();
console.log(`ערוץ: ${transport.name}${transport.simulated ? " (מדומה)" : ""}`);
console.log(`שולח אל ${to}…`);

if (transport.simulated) {
  console.error("✖ נבחר ערוץ מדומה — ההודעה לא תצא לאיש. ההגדרה לא נקלטה.");
  process.exit(1);
}

const stamp = new Date().toISOString();
const started = Date.now();

await transport.send({
  to,
  subject: `בדיקת ערוץ — בקרת פניות Y&Y`,
  text: `הודעת בדיקה שנשלחה ב-${stamp}.\nאם הגיעה, ערוץ ה-SMTP של Gmail עובד.`,
  html: `<div dir="rtl">הודעת בדיקה שנשלחה ב-${stamp}.<br>אם הגיעה, ערוץ ה-SMTP של Gmail עובד.</div>`,
});

console.log(`✔ ההודעה יצאה תוך ${Date.now() - started}ms`);
