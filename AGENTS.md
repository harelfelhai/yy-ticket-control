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
- **מקור אמת עיצובי:** `docs/DESIGN.md`. **לפני כתיבת קוד שנוגע ב-UI — לקרוא אותו.**
  ערך שאינו מופיע שם אינו מומצא בקוד: מוסיפים אותו למסמך קודם.
- **כל מחרוזת שמוצגת למשתמש עוברת דרך `src/lib/he.ts`.** אין עברית מפוזרת בקומפוננטות.
- הממשק RTL בלבד (`<html lang="he" dir="rtl">`), פונט Assistant, ערכת צבע בהירה בלבד.
  **חובה מחלקות לוגיות ולא פיזיות** — `ms/me`, `ps/pe`, `text-start/end`, `border-s/e`,
  `start-*/end-*`. `ml-`, `pr-`, `text-left`, `border-l` ודומיהן שבורות ב-RTL. פירוט
  והחריגים ב-`docs/DESIGN.md` § Layout.
- שרת פיתוח על פורט **3100** (פורט 3000 תפוס במכונה על ידי פרויקט אחר).
- סודות רק ב-`.env.local` וב-Railway Variables. לעולם לא בקוד ולא בגיט.
- אין להשתמש בתו `&` בשמות נתיבים בפרויקט — הוא שובר את ה-shims של npm ב-Windows.

## בסיס הנתונים חייב locale מודע ל-UTF-8 — אחרת החיפוש שבור בשקט

**כל בסיס נתונים של הפרויקט נוצר כך, ואין יוצא מן הכלל:**

```sql
CREATE DATABASE <name>
  LOCALE_PROVIDER icu ICU_LOCALE 'he-IL' LOCALE 'en-US'
  TEMPLATE template0 ENCODING 'UTF8';
```

**למה זה אילוץ ולא העדפה.** `pg_trgm` מסווג תווים לפי ה-`LC_CTYPE` של בסיס הנתונים.
תחת `LC_CTYPE = C` — ברירת המחדל של `initdb` בהתקנות רבות — כל בית מעל `0x80` אינו נחשב
אות, ולכן `show_trgm('נזילה')` מחזיר **`{}`**. אינדקסי החיפוש קיימים, נראים תקינים
ב-`\di`, ו**ריקים מעברית לחלוטין**: כל שאילתה עברית מחזירה את *כל* השורות כמועמדות ואז
מסננת אותן ידנית — אותה עבודה כמו סריקה מלאה, בתוספת האינדקס.

זה קרה בפועל. הפרויקט רץ כך מ-22.7.2026, ואף בדיקה לא נכשלה.

נמדד על 20,000 שורות: **1.6ms** עם locale תקין מול **24.8ms** בלעדיו, ובלי תוצאות שווא.

- **`ALTER DATABASE` אינו יכול לשנות `LC_CTYPE`.** תיקון = `pg_dump` → יצירה מחדש → שחזור.
- **`COLLATE` ברמת ביטוי אינו עוזר** (נבדק) — הוא משפיע על סדר השוואה, לא על סיווג תווים.
- **`he-IL` נבחר גם למיון:** תחת `C` עברית מוינה לפי ערך בייט ולא אלפביתית.
- נאכף ב-`tests/integration/search-indexes.test.ts`, שנכשל אם `show_trgm` על מילה עברית
  מחזיר קבוצה ריקה.

**סטטוס:** dev, test, e2e ו-shadow הומרו ב-24.8.2026.

**הפרודקשן ב-Railway מעולם לא סבל מזה** — הוא נוצר עם `en_US.utf8`, ו-`show_trgm` על
מילה עברית מחזיר שם שש שלשות. הבעיה הייתה מקומית בלבד, מפני ש-`initdb` על Windows יצר
את בסיסי הנתונים עם `C`. **מי שמריץ את הפרויקט על מכונה חדשה חייב לבדוק את זה** —
הבדיקה ב-`tests/integration/search-indexes.test.ts` היא מה שיאמר לו.

מתקן טעות שנכתבה כאן קודם: התיעוד הראשון קבע שהפרודקשן על `C`, וזו הייתה **הנחה שלא
נבדקה**. האבחון בפועל (24.8.2026) הראה `en_US.utf8`. מה שכן חסר שם הוא ארבעת האינדקסים
שנמחקו — תקלה נפרדת, שהמיגרציה `restore_search_trigram_indexes` מטפלת בה.
