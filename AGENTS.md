<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Next.js 16 — שינויים שוברים שכבר אומתו בפרויקט הזה

מקור: `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.

- **`middleware.ts` הוחלף ב-`proxy.ts`.** הקובץ ייקרא `src/proxy.ts` וה-export ייקרא `proxy`.
  ה-runtime הוא `nodejs` בלבד (אין `edge`, ואי אפשר להגדיר) — ולכן מותר לגשת שם ל-DB.
  דגלי קונפיג התחלפו בהתאם: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`.
- **Async Request APIs.** `cookies()`, `headers()`, `draftMode()`, וכן `params`/`searchParams`
  ב-`page`/`layout`/`route` הם **Promise**. גישה סינכרונית הוסרה לחלוטין.
- **Turbopack הוא ברירת המחדל** ל-`next dev` ול-`next build`. אין צורך בדגל.
- **`next lint` הוסר.** מריצים `eslint` ישירות (`npm run lint`), ו-`next build` לא מריץ לינט.
- **`revalidateTag` דורש ארגומנט שני** (פרופיל `cacheLife`). לקריאה-אחרי-כתיבה יש `updateTag`.
- טיפוסים ל-props אסינכרוניים: `npx next typegen` מייצר `PageProps<'/route'>`, `LayoutProps`, `RouteContext`.

## מוסכמות הפרויקט

- **מקור אמת פונקציונלי:** `docs/specs/ticket-control-pre-plan.md`. אין להמציא התנהגות שלא כתובה שם.
- **כל מחרוזת שמוצגת למשתמש עוברת דרך `src/lib/he.ts`.** אין עברית מפוזרת בקומפוננטות.
- הממשק RTL בלבד (`<html lang="he" dir="rtl">`), פונט Heebo, ערכת צבע בהירה בלבד.
- שרת פיתוח על פורט **3100** (פורט 3000 תפוס במכונה על ידי פרויקט אחר).
- סודות רק ב-`.env.local` וב-Railway Variables. לעולם לא בקוד ולא בגיט.
- אין להשתמש בתו `&` בשמות נתיבים בפרויקט — הוא שובר את ה-shims של npm ב-Windows.
