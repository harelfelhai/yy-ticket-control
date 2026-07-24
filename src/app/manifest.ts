import type { MetadataRoute } from "next";
import { BRAND_BACKGROUND, BRAND_COLOR } from "@/lib/brand";
import { he } from "@/lib/he";

/**
 * ה-Web App Manifest — מה שמאפשר "הוסף למסך הבית".
 *
 * זו הבחירה המכוונת של M6: **manifest מינימלי בלבד, בלי service worker.**
 * המערכת נשארת אתר ווב רגיל; ה-manifest רק נותן לדפדפן להציע אייקון על
 * מסך הבית שנפתח במסך מלא (בלי שורת הכתובת). אין כאן אפליקציה נייטיב ואין
 * APK. ההגנה מפני "פנייה שהולכת לאיבוד" בלי רשת כבר ממומשת ברמת האפליקציה
 * ב-`offline-draft.ts`, ולכן service worker — על מורכבות ה-cache שלו —
 * אינו נדרש כאן.
 *
 * ‏Next מגיש קובץ זה ב-`/manifest.webmanifest` ומקשר אליו אוטומטית מכל דף.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // מזהה יציב לאפליקציה, נפרד מ-start_url, כדי שהדפדפן לא ייצור התקנה
    // כפולה אם כתובת הפתיחה תשתנה בעתיד.
    id: "/",
    name: he.app.title,
    short_name: he.app.name,
    description: he.app.description,
    lang: "he",
    dir: "rtl",
    // הפתיחה מובילה ללוח. משתמש לא מחובר יופנה משם למסך ההתחברות וחזרה.
    start_url: "/board",
    scope: "/",
    display: "standalone",
    background_color: BRAND_BACKGROUND,
    theme_color: BRAND_COLOR,
    icons: [
      // "any" — האייקון כפי שהוא, לדפדפן ולמסכים שאינם חותכים.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // "maskable" — אנדרואיד חותך לצורת המכשיר; הרקע המלא ממלא את הפינות.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
