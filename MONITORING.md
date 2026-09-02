# ניטור ותצפית (Observability) — Y&Y

**עודכן: 29 ביולי 2026**

המערכת מדווחת שגיאות, לוגים מובנים, וכשלים-שקטים ל-**פרויקט Sentry יחיד**.
אין push notifications — המשטח הוא ה-dashboard + מייל ברירת-המחדל של Sentry
(issue חדש / check-in שהוחמץ).

- **פרויקט:** `yy-ticket-control` (org `harel-09`, region אירופאי).
- **‏Dashboard:** https://harel-09.sentry.io/issues/?project=4511816836317264
- **‏Logs:** https://harel-09.sentry.io/explore/logs/
- **‏Crons:** https://harel-09.sentry.io/crons/

---

## מה מנוטר ואיך

### 1. שגיאות מסלול הבקשה (אוטומטי)
‏Server Actions, Server Components, ו-route handlers — נתפסים ע"י
`onRequestError` (‏`src/instrumentation.ts`) וע"י ה-`guard` ב-
`src/lib/action-result.ts` שזורק מחדש שגיאות לא-צפויות. שגיאת רינדור עליונה
בלקוח → `src/app/global-error.tsx`.

### 2. תת-מערכת ה-worker/jobs (המוקד)
ה-worker רץ בתוך תהליך השרת ואינו "בקשה", ולכן `onRequestError` אינו מכסה
אותו — הלכידה מפורשת ב-`src/jobs/worker.ts`:

| מה | מתי נלכד | fingerprint |
|---|---|---|
| כשל job **סופי** (מייל/AI/גיבוי/הסלמה) | `attempts >= MAX_ATTEMPTS` | `["job-failed", <type>]` |
| אתחול התור בעלייה נכשל | תמיד | `["worker-startup-failed"]` |
| תזמון-מחדש אחרי כשל נכשל | תמיד | `["reschedule-failed", <type>]` |
| לולאת ה-poll נכשלה (DB down) | פעם ב-10 דק' (throttle) | `["poll-loop-db-down"]` |

**לא** לוכדים על retry זמני — רק על כשל סופי, כדי לא להציף.

### 3. לוגים עסקיים (Sentry Logs)
אירועים חיפושיים עם attributes (לא פרוזה): `ticket.created`,
`assignments.applied`, `notify.sent`, `notify.no-address` (warn — קבלן בלי
מייל), `notify.skipped`, `portal.action`, `escalation.done`, `backup.done`.
מקור אמת: `src/lib/observability/log.ts`.

> **‏`notify.no-address` חדל להיות "אין מה לעשות" (2.9.2026).** עד §5.ה2 הוא
> היה הסימן **היחיד** לכך שקבלן בלי מייל לא יודע על הפנייה — סימן שיושב
> ב-Sentry ולא מול מנהל העבודה. היום המסך מציג "נותר לשלוח בוואטסאפ",
> והשדה `Assignment.waOpenedAt` מתעד את הפתיחה. הלוג נשאר כפי שהוא: הוא
> עדיין מודד **כמה** פניות תלויות בפעולה ידנית, וזו המדידה שתגיד אם SMS
> הפך לנחוץ.

### 4. הגנת silent-failure — ה-watchdog
כשל שקט אינו זורק חריגה. ה-watchdog רץ **in-process כל 6 שעות**
(`src/jobs/worker.ts` → `runWatchdog`), מאמת invariants, ומדווח check-in
ל-**cron monitor יחיד** בשם `watchdog`:

| invariant | סף | מה זה תופס |
|---|---|---|
| `escalation-heartbeat` | < 26 שעות | ההסלמה היומית (06:00) הפסיקה לרוץ |
| `backup-heartbeat` | < 27 שעות | הגיבוי הלילי (03:00) הפסיק לרוץ |
| `queue-not-stuck` | אין PENDING באיחור > 20 דק' | לולאת התור מתה |
| `jobs-not-failing` | אין FAILED ב-24 השעות האחרונות | **תקלת תצורה מתמשכת** — מפתח חסר, כלי בגרסה שגויה |

כל invariant שנכשל → issue נפרד (`fingerprint: ["watchdog", <name>]`).
**אם התהליך עצמו מת** — ה-check-in נעצר, ו-Sentry מתריע על "missed" (‏interval
של 6 שעות + margin של 30 דק'). אין שומר בלי שומר.

הפעימות (`Heartbeat` table) נכתבות ע"י ג'ובי ההסלמה/הגיבוי כשורה אחרונה אחרי
הצלחה, ונזרעות בעליית ה-worker דרך **`seedHeartbeat`** — זריעה שאינה דורסת
פעימה קיימת.

> **שני התיקונים של 31.8.2026, ולמה הם נדרשו.** אימות הפרודקשן מצא **32
> ג'ובי גיבוי ו-14 ג'ובי מייל שנכשלו סופית** לאורך חודש, בלי שאיש ידע. שתי
> חורים אפשרו זאת, וכל אחד מהם נסגר כאן:
>
> 1. **הזריעה דרסה.** העלייה קראה ל-`setHeartbeat`, שהוא `update` — כלומר
>    **כל פריסה** החזירה את שעון ההתיישנות ל-`now` והשתיקה את
>    `backup-heartbeat` ל-27 שעות. בשירות שפורס אוטומטית על כל push ל-`main`
>    זו השתקה כמעט תמידית: האזעקה יכלה לצלצל רק אחרי שהפריסות פסקו ליותר
>    מיממה. ‏`seedHeartbeat` משתמש ב-`update: {}` — פעימה ישנה נשארת ישנה.
> 2. **לא היה invariant על עבודה שנכשלה.** ‏`queue-not-stuck` מביט ב-PENDING
>    בלבד, ולכידת ה-Sentry הפר-job היא **אירוע חד-פעמי** שנקבר ברשימה.
>    ‏`jobs-not-failing` נשאל מחדש כל שש שעות, ולכן תקלת תצורה מתמשכת אינה
>    יכולה עוד להיקרא כתקלה שטופלה. החלון של 24 שעות הוא מה שמאפשר לאזעקה
>    להיסגר מעצמה — אזעקה שאי אפשר לכבות נלמדת להתעלם.

---

## איך מוסיפים invariant חדש (משימת 5 דקות)

1. אם צריך פעימה חדשה: הוסף שם ל-`HEARTBEAT` ב-`src/watchdog/heartbeat.ts`,
   וקרא ל-`setHeartbeat(HEARTBEAT.<name>, now)` בסוף הג'וב המוצלח. **בעלייה
   — `seedHeartbeat` בלבד**, לעולם לא `setHeartbeat`: ראה האזהרה למעלה.
2. הוסף אובייקט ל-`checks` ב-`src/watchdog/checks.ts` — `{ name, async run(now) { if (<תנאי-כשל>) throw new Error("...") } }`. השתמש בפרדיקטים הטהורים מ-`predicates.ts` (בדוקים ב-unit).
3. הוסף בדיקה ל-`tests/integration/watchdog.test.ts` (fresh עובר / stale זורק).
4. זהו — ה-runner מריץ את כל ה-checks אוטומטית, וכל כשל הופך ל-issue נפרד.

**אין ליצור monitor שני** (מגבלת free-tier: monitor אחד). הכול עובר דרך
ה-watchdog היחיד.

---

## תקציב free-tier (‏Developer plan)

| מכסה | גבול | הגישה |
|---|---|---|
| שגיאות | 5,000/חודש | fingerprints ממזגים; לכידה על כשל סופי בלבד; throttle ללולאה |
| ‏Spans (tracing) | 5M/חודש | `tracesSampleRate: 1.0` — 6 משתמשים, רחוק מהמכסה |
| לוגים | 5GB/חודש | אירועים עסקיים בלבד, לא רעש בקשות |
| **‏Cron monitors** | **1** | ה-watchdog לבדו; כל השאר טרנזיטיבי דרך פעימות |
| ‏Replays | 50/חודש | **מושבת** (משקל bundle ברשת סלולרית) |

---

## משתני סביבה לפרודקשן (Railway)

| משתנה | תפקיד |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | ה-DSN (לא סוד — יכול רק לשלוח, לא לקרוא). נדרש בבנייה ובריצה. |
| `SENTRY_ORG` = `harel-09` | להעלאת source-maps בבנייה |
| `SENTRY_PROJECT` = `yy-ticket-control` | להעלאת source-maps בבנייה |
| `SENTRY_AUTH_TOKEN` | טוקן להעלאת source-maps (סוד — Railway Variables בלבד) |

מקומית ה-DSN ב-`.env.local` (gitignored). ב-E2E מוגדר `NEXT_PUBLIC_SENTRY_DSN=""`
כדי ש-Sentry לא יזהם את תצוגת prod בנתוני-בדיקה.

---

## מה אומת (חי, מקומי) ומה ממתין לפריסה

**אומת חי מ-localhost אל Sentry (29.7):**
- תפיסת שגיאה (server) → אירוע ב-Sentry.
- כשל job סופי (`boom`) → הג'וב FAILED + `captureError` על המסלול הסופי.
- ה-watchdog → monitor `watchdog` נוצר; check-ins `ok` (תקין) ו-`error` (invariant שבור).

**מאומת רק אחרי פריסת Railway** (דורש תהליך ארוך-חיים, App-Sleeping כבוי):
- אזעקת **missed check-in** אמיתית של ה-watchdog מעל חלון 6 שעות.
- ריצות 06:00/03:00 אמיתיות שמקדמות פעימות.
- **‏source-maps** — ‏stack traces קריאים על בניית prod (דורש `SENTRY_AUTH_TOKEN` בבנייה).
- אירועי לקוח ממכשירי שטח אמיתיים (מובייל).

מקורות אמת קשורים: `docs/deployment-status.md` · זיכרון `yy-hosting-decision-pending`.
