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

## פקודות

ההקמה המלאה (`db:up` → `db:migrate` → `db:seed`, מילוי `.env`) מתועדת ב-`README.md`.

| פקודה | מה היא עושה |
|---|---|
| `npm run dev` | שרת פיתוח על 3100 מול `yy_dev` |
| `npm run verify` | typecheck + lint + vitest — השער לפני push |
| `npm run typecheck` | `next typegen && tsc --noEmit` (הטיפוסים `PageProps` וכו׳ נוצרים כאן) |
| `npm run test:unit` / `test:integration` | Vitest: jsdom בלי DB / node מול `yy_test` (סדרתי, הבסיס מרוקן בין בדיקות) |
| `npx vitest run tests/unit/permissions.test.ts` | קובץ בודד; `-t "שם"` לבדיקה בודדת |
| `npm run test:e2e` | Playwright על 3101 מול `yy_e2e`, מובייל + דסקטופ |
| `npx playwright test e2e/board.spec.ts --project=desktop --reporter=line` | spec בודד |
| `npm run test:e2e:prod` | אותן בדיקות מול `next build && next start` — **חובה** לכל שינוי בהודעות שגיאה של Server Actions (ראו "חוזה ה-Server Actions") |
| `npm run test:conformance[:prod]` | חבילת ההתאמה לאפיון, 3102, 30+ דקות |
| `npm run visual` | צילומי מסך לביקורת עיצוב אל `.visual/` (לא snapshot diff) |
| `npm run design:lint` | אימות `docs/DESIGN.md` |
| `npm run smoke:prod` | קריאה-בלבד מול הפרודקשן: האם מה שמוגש תואם לקוד בריפו |
| `npx tsx scripts/measure-board.mts` | מדידת זמן החלפת מסנן בלוח — לפני ואחרי שינוי שנוגע בביצועי הלוח |

**שלושה שרתים, ארבעה בסיסי נתונים.** 3100/`yy_dev` פיתוח · 3101/`yy_e2e` ‏E2E ו-visual ·
3102/`yy_e2e` ‏conformance · `yy_test` אינטגרציה · `yy_shadow` ל-`migrate dev`. כולם על
Postgres 18 מקומי (`embedded-postgres`, פורט 5433, נתונים ב-`.localdb/`), בלי דוקר.

**‏E2E ו-conformance אינם רצים לצד שרת הפיתוח.** Next 16 חוסם `next dev` שני באותה תיקייה
(לא באותו פורט). לפני `test:e2e` יש לעצור את שרת ה-dev — או להריץ `test:e2e:prod`, שעליו
החסימה אינה חלה. E2E ו-conformance חולקים את `yy_e2e` ומרוקנים אותו בעלייה, ולכן גם הם
רצים בזה אחר זה בלבד.

**‏`prod-qa/` כותב לפרודקשן החי.** אין לו `globalSetup` בכוונה — ה-setup של `e2e/` מרוקן
כל טבלה, והפנייתו לכתובת הפרודקשן הייתה מוחקת את המערכת.

**‏PostToolUse hook** ב-`.claude/settings.json` מריץ `tsc --noEmit` על כל הפרויקט אחרי כל
עריכת `.ts`/`.tsx`. שגיאת טיפוסים חוזרת מיד — אין צורך להריץ typecheck ידנית אחרי עריכה.

## ארכיטקטורה — מה שלא נראה מקובץ בודד

**מסלול בקשה.** `src/proxy.ts` בודק רק את *קיום* עוגיית הסשן (בדיקה אופטימית, מפנה
ל-`/login?next=`). ההרשאה האמיתית היא `requireUser()` ב-`src/lib/auth.ts`, שמרענן את
המשתמש מול ה-DB בכל מסך מוגן — עוגייה תקפה אינה מוכיחה שהמשתמש עדיין פעיל. הפורטל החיצוני
`/p/[token]` אינו בסשן כלל: הטוקן מזהה *מי* (`services/portal.ts`), והשיוכים הפעילים קובעים
*מה רואים* — לכן הקישור יציב וללא תפוגה, והסרת נמען חוסמת אותו מיידית.
`services/viewer.ts` מאחד את שני המסלולים ל-`Viewer` אחד, ו-`src/lib/permissions.ts` הוא
המקום היחיד שעונה "מי רשאי מה" — פונקציות טהורות, כל ההקשר בפרמטרים.

**חוזה ה-Server Actions** (`src/lib/action-result.ts`). כל action מחזיר
`ActionResult<T>` — שגיאה **כערך, לא כחריגה** — דרך `guard()`, שממיר `UserFacingError`
להודעה וזורק מחדש כל דבר אחר (זה באג שצריך להגיע ל-Sentry). הסיבה: Next מצנזר הודעות
שגיאה זרוקות בפרודקשן ל"משהו השתבש", ובפיתוח לא — ולכן הפרה של החוזה **עוברת את כל הבדיקות
המקומיות** ונתפסת רק ב-`test:e2e:prod`. בצד הלקוח `useAction()` (`src/lib/use-action.ts`)
הוא הדרך היחידה להפעיל action: הוא מחזיק `busy` (=`pending || !hydrated`), `error` ו-`run`.
לא לכתוב `useTransition` + `useState<string>` ידנית בקומפוננטה.

**שכבות.** `app/**/actions.ts` (דק: אימות zod, `guard`, קריאה לשירות) →
`src/lib/services/*` (הלוגיקה העסקית, זורק `UserFacingError` עם נוסח מ-`he.ts`) →
`src/lib/db.ts` (Prisma 7 דרך `@prisma/adapter-pg`, singleton, timeouts מפורשים על הבריכה).
הלקוח המחולל יושב ב-`src/generated/prisma` — לייבא משם, לא מ-`@prisma/client`.

**סטטוס פנייה הוא נגזר, לא שמור.** `src/lib/ticket-status.ts` מחשב
`DerivedTicketStatus` ו-`BoardSection` מתוך סטטוסי השיוכים, טהור לחלוטין (גם "עכשיו" הוא
פרמטר). אין שדה סטטוס על `Ticket` ואין להוסיף כזה.

**תור ו-worker בתוך תהליך השרת.** התור הוא טבלת `Job` ב-Postgres (`src/jobs/queue.ts`),
בלי Redis; ה-worker עולה מ-`src/instrumentation.ts` עם השרת (זו הסיבה שהאירוח הוא Node
קבוע ולא serverless, וש-App Sleeping ב-Railway חייב להיות כבוי). שני כללים: ג׳וב נוצר
**באותה טרנזאקציה** של הפעולה שיצרה אותו, והמטען מכיל **מזהים בלבד** — הטקסט מנוסח בזמן
השליחה. סוגי הג׳ובים ב-`src/jobs/types.ts` (מחרוזת, לא enum — כדי לא לדרוש מיגרציה).
הג׳ובים היומיים (הסלמה 06:00, גיבוי 03:00 שעון ישראל) מתזמנים את עצמם מחדש;
`src/jobs/schedule.ts` הוא החישוב הטהור של שעון-הקיץ.

**כשלים שקטים.** `src/watchdog/` רץ כל 6 שעות מתוך ה-worker, מאמת invariants
(`checks.ts`, על בסיס פעימות `Heartbeat`) ומדווח ל-cron monitor **יחיד** ב-Sentry — מגבלת
free-tier, אין ליצור שני. הוספת invariant: `MONITORING.md`. כל לוג ותפיסת שגיאה עוברים דרך
`src/lib/observability/log.ts` — לא `console.error` ולא `Sentry.*` ישירות. בפיתוח Sentry
מנוטרל (`SENTRY_DEV=1` מחזיר אותו).

**בחירת ספק לפי סביבה — תבנית אחת.** `storage/index.ts` (R2 / דיסק מקומי),
`notifier/email.ts` (‏Gmail SMTP / לוג), `ai/gemini.ts` (‏Gemini — תמלול וחילוץ טקסט / SKIPPED):
בפיתוח חוסר הגדרה נופל ל-fallback שקט; בפרודקשן הוא **כשל רועש**, אלא אם נאמר במפורש
(`MEDIA_STORAGE=local`). משתני סביבה נקראים רק דרך `src/lib/env.ts` (עצל), לא
`process.env` בלוגיקה.

**בדיקות שקוראות את קוד המקור כטקסט.** `tests/unit/{primitives,typography,spacing,
layout-guards,touch-variant,palette}.test.ts` (על `tests/unit/source-scan.ts`) אוכפות את
DESIGN.md על הקוד: כפתור שאינו `<Button>`, כותרת שקובעת גודל בעצמה, `gap-1.5`, `max-w-*`
ישיר — כולם מפילים את `test:unit`. `tests/conformance/source/scope-boundaries.test.ts`
אוכף את **היעדר** הפיצ׳רים שהאפיון §6 הוציא מהתחולה. כשאחת מהן נכשלת התיקון הוא בקוד, לא
ברשימת ההחרגות — הרשימות קצרות בכוונה וכל חריג נושא נימוק.

**חבילת ההתאמה** (`conformance/`) משווה מול מחרוזות שהועתקו מהאפיון
(`conformance/fixtures/spec-text.ts`), **לעולם לא** מול import מ-`he.ts`. המיפוי
דרישה ← מימוש ← בדיקה ב-`docs/specs/conformance-matrix.md`.

**מסמכים נוספים:** `MONITORING.md` (Sentry, watchdog, תקציב free-tier) ·
`docs/deployment-status.md` (Railway: `Dockerfile` עם לקוח PGDG,
`preDeployCommand` מריץ מיגרציות, worker דורש קונטיינר ער) ·
`.claude/skills/ship` (לולאת ההעלאה: ענף ← PR ← שער ← מיזוג; לא `railway up`).

## השער: אין דחיפה ישירה ל-`main`

מ-1.9.2026 הריפו **ציבורי** ועל `main` יש branch protection שדורש את שתי
הבדיקות `verify` ו-`e2e`. המסלול הוא **ענף ← PR ← שער ירוק ← מיזוג**,
והמיזוג הוא מה שפורס.

`.github/workflows/verify.yml` — שלושה jobs: `verify` (typecheck+lint+vitest,
כל push ו-PR) · `e2e` (אחרי verify, מול בניית פרודקשן) · `conformance`
(לילי ב-04:00 ובהפעלה ידנית בלבד — 60 דקות).

שני דברים שחשוב לדעת:

- **הפריסה אינה מחכה ל-CI.** מתג ה-`Wait for CI` של Railway כבוי בהכרעת
  בעל המוצר (1.9.2026) — 20 דקות לכל פריסה. ההגנה היא שער ה-PR
  בלבד; מיזוג שעוקף אותו ייפרס בלי שדבר יעצור אותו.
- **אירועי push של GitHub אובדים לעיתים.** ב-1.9.2026 שתי דחיפות מתוך
  ארבע נחתו ברימוט בלי ליצור ריצה, בלי שום אירוע תקלה אצל GitHub.
  לא להניח שריצה התחילה — לאמת עם
  `gh api "repos/<owner>/<repo>/actions/runs?branch=<b>"`, ולאלץ בעת הצורך עם
  `gh workflow run verify.yml --ref <branch>`.

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

## בדיקות ארוכות (conformance)

- חבילת ה-conformance (`npm run test:conformance`) רצה **יותר מ-30 דקות**. להריץ אותה עם
  `--reporter=line` ולהזרים פלט מצטבר; לדווח למשתמש התקדמות כל כמה דקות — לא לשתוק לאורך הריצה.
- קודם להריץ את קובצי ה-spec הממוקדים לאזור שהשתנה, ואת החבילה המלאה רק לפני push.

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
