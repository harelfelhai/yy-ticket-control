/**
 * הרצה בפועל של ערוץ המייל — בלי DB ובלי ליצור פנייה.
 *
 * ‏`smoke-notify` בודק את הצינור המלא, ולכן הוא **כותב**: יוצר קבלן ופנייה.
 * מול פרודקשן זה מזהם את בסיס הנתונים. כאן נבדק רק מה ש-`smoke-notify`
 * אינו יכול לבדוק בנפרד — שהאימות מול Gmail עובר ושההודעה יוצאת.
 *
 * הרצה מול פרודקשן, בלי לחשוף את הסיסמה:
 *   railway run --service web -- npx tsx scripts/smoke-mail.mts
 *
 * ‏`railway run` מזריק את משתני הסביבה לתהליך הבן. הסיסמה אינה מודפסת
 * ואינה נכתבת לשום מקום.
 */

const { selectEmailTransport, isEmailConfigured } = await import("../src/lib/notifier/email");
const { env } = await import("../src/lib/env");

const to = process.argv[2] ?? env.gmailUser();

if (!isEmailConfigured()) {
  console.error("✖ ערוץ המייל אינו מוגדר: חסרים GMAIL_USER או GMAIL_APP_PASSWORD");
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
