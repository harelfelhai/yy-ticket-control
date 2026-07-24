/**
 * כותרות אבטחה ל-HTTP — מקור אמת יחיד, נצרך מ-`next.config.ts`.
 *
 * מופרד למודול טהור כדי שאפשר יהיה לבדוק ביחידה: מה נשלח, ובמה dev שונה
 * מ-production. בלי זה, ההבדל בין הסביבות נבלע בתוך קובץ ה-config ואי אפשר
 * לאמת שב-production ה-CSP באמת מחמיר.
 *
 * ‏CSP — הכרעה והנמקה:
 * האפליקציה אינה טוענת שום משאב חיצוני (הפונט מתארח עצמאית דרך next/font,
 * המדיה דרך R2 ב-https), ואין בקוד שום `dangerouslySetInnerHTML` — ‏React
 * ממ­לט (escape) כל טקסט משתמש, וזו ההגנה העיקרית מפני XSS. ה-CSP כאן הוא
 * שכבת הגנה-לעומק.
 *
 * ‏`script-src 'unsafe-inline'`: ‏Next מזריק סקריפט bootstrap מוטבע להזנת
 * ה-hydration. חלופה מחמירה היא nonce לכל בקשה דרך ה-proxy — אבל היא כופה
 * רינדור דינמי על כל דף ומחייבת שה-proxy ירוץ גם על הפורטל `/p/*` (שכרגע
 * מחוץ ל-matcher בכוונה). זו החמרה אפשרית בעתיד; לכלי פנימי של 6 משתמשים,
 * שבו React-escaping כבר סוגר את משטח ה-XSS, הבחירה כאן היא inline מתועד.
 * מה ש-CSP כן חוסם כאן ומשמעותי: הטמעה ב-iframe (clickjacking), הזרקת
 * `<base>`, חטיפת יעד טופס, ותוספי plugin.
 *
 * ‏dev מרפה שתי הגבלות שה-HMR של Turbopack דורש: `'unsafe-eval'` (הידור
 * מודולים תוך כדי ריצה) ו-`ws:` (ערוץ העדכון החם). ב-production שתיהן יורדות.
 */

export interface HttpHeader {
  key: string;
  value: string;
}

export function buildContentSecurityPolicy(isDev: boolean): string {
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";
  const connectSrc = isDev ? "'self' https: ws:" : "'self' https:";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // ‏next/font מזריק style-face מוטבע, וקומפוננטות משתמשות ב-style דינמי.
    "style-src 'self' 'unsafe-inline'",
    // ‏data:/blob: לתצוגה מקדימה מקומית לפני העלאה; https: למדיה מ-R2.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self'",
    // ‏https: להעלאת/משיכת מדיה מול כתובות presigned של R2.
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function buildSecurityHeaders(isDev: boolean): HttpHeader[] {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(isDev) },
    // ‏HSTS: נכבד רק מעל https, ולכן שליחה תמידית בטוחה (מעל http localhost
    // הדפדפן מתעלם). ‏includeSubDomains חל על תת-הדומיינים של המארח בלבד.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // מגן על טוקן הפורטל: בקשה חוצת-מקור (מדיה מ-R2) תשלח origin בלבד, לא
    // את הנתיב שמכיל את הטוקן.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // המערכת משתמשת במצלמה ובמיקרופון (צילום ליקוי, הקלטה קולית) — מותרים
    // ל-self; כל השאר חסום.
    {
      key: "Permissions-Policy",
      value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
  ];
}
