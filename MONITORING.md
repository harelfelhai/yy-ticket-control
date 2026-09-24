# ניטור ותצפית (Observability) — Y&Y

**עודכן: 18 בספטמבר 2026**

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

**מסלול קליטת המייל (1.3) מוסיף לכידות שאינן ג׳וב.** סבב ה-poll הוא טיימר
בתוך התהליך ולא שורה בטבלת `Job`, ולכן הוא אינו עובר דרך `worker.ts`:

| מה | מתי נלכד | היכן |
|---|---|---|
| הסבב נעצר — התיבה שענתה אינה `GMAIL_USER`, או שגיאת `scope`/`auth` | כל סבב, עם rate-limit | `services/email-poll.ts` |
| רוויית דפדוף — 20 עמודים לשאילתה אחת | כשהתקרה נגמרת | `services/email-poll.ts` |
| הודעה שנתקעה ב-PENDING ותוזמנה מחדש | בסריקת התקיעות | `services/email-poll.ts` |

**rate-limit ולא לכידה בכל סבב**: הטיימר רץ כל 60 שניות, ולכן תקלת הרשאה
שנמשכת יום הייתה 1,440 אירועים — אותו שיקול בדיוק שהוליד את ה-throttle של
`poll-loop-db-down` בטבלה שמעל. מה שמבטיח שהתקלה לא תיבלע למרות ה-rate-limit
הוא ה-invariant `email-intake-configured`, שנשאל מחדש כל שש שעות.

### 3. לוגים עסקיים (Sentry Logs)
אירועים חיפושיים עם attributes (לא פרוזה): `ticket.created`,
`assignments.applied`, `notify.sent`, `notify.no-address` (warn — קבלן בלי
מייל), `notify.skipped`, `portal.action`, `escalation.done`, `backup.done`.
מקור אמת: `src/lib/observability/log.ts`.

**אירועי קליטת המייל (1.3):**

| אירוע | מה הוא אומר |
|---|---|
| `email.poll` (info) | סבב הסתיים. `queries`, `discovered`, `skipped`, `pages` — כמה נשאל, כמה נכנס ליומן, כמה כבר היו, כמה עמודים |
| `email.poll.halted` (error) | הסבב נעצר לפני שקרא דבר: התיבה שענתה אינה זו שהוגדרה, או הרשאה שנשללה |
| `email.poll.saturated` | תקרת 20 העמודים לשאילתה נגמרה: או שהחלון רחב מדי, או שהתיבה מוצפת |
| `email.extraction.dropped_unquoted` | החילוץ החזיר ערך שאינו מופיע מילה במילה בטקסט, והערך נזרק |
| `email.reply.sent` | תשובה יצאה. `latencySec` נמדד מ-`receivedAt` |
| `email.reply.late` | אותה תשובה מעבר ל-300 שניות — **ההבטחה של §2.6 שלב 4 הופרה** |

`email.reply.late` אינו תקלה שמישהו ידווח עליה: השולח קיבל תשובה, רק מאוחר.
הוא קיים כדי שהמספר שבאפיון — חמש דקות — יהיה **נמדד** ולא מוצהר, וכדי
שהחמרה הדרגתית תיראה לפני שהיא הופכת לשעה.

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
| `google-login-configured` | ‏`GOOGLE_CLIENT_ID` ו-`GOOGLE_CLIENT_SECRET` מוגדרים בפרודקשן | **תצורה שאינה מייצרת ג׳וב** — התחברות בגוגל שפשוט אינה מוצגת |
| `email-poll-heartbeat` | < 15 דקות, **רק כשהיכולת דלוקה** | טיימר הקליטה (כל 60 שניות) מת — אף מייל אינו נקרא |
| `email-intake-not-stuck` | אין `MailboxMessage` ב-PENDING מעל 30 דקות | הודעה שנקלטה ואיש לא הכריע בה, או תשובה שלא יצאה |
| `email-intake-configured` | היכולת דלוקה בפרודקשן ⇒ יש טוקן Gmail ו-`GEMINI_API_KEY` | **תצורה שאינה מייצרת ג׳וב** — יכולת דלוקה שאינה יכולה לקרוא, או שכל מייל בה נוחת ב"החילוץ אינו זמין" |

כל invariant שנכשל → issue נפרד (`fingerprint: ["watchdog", <name>]`).
**אם התהליך עצמו מת** — ה-check-in נעצר, ו-Sentry מתריע על "missed" (‏interval
של 6 שעות + margin של 30 דק'). אין שומר בלי שומר.

הפעימות (`Heartbeat` table) נכתבות ע"י ג'ובי ההסלמה/הגיבוי כשורה אחרונה אחרי
הצלחה, ונזרעות בעליית ה-worker דרך **`seedHeartbeat`** — זריעה שאינה דורסת
פעימה קיימת. הפעימה השלישית, `email-poll`, נכתבת בסוף כל **סבב poll** מוצלח
ולא בסוף ג׳וב יומי — ולכן הסף שלה נמדד בדקות ולא בשעות. גם היא נזרעת בעלייה,
אחרת הפריסה הראשונה הייתה מתריעה לפני שהטיימר הספיק לרוץ פעם אחת.

> **שלושת ה-checks של המייל שומרים על אותה הבטחה, משלושה כיוונים.** §2.6 שלב 4
> מבטיח תשובה תוך חמש דקות, וההבטחה נשברת בשקט בשלוש דרכים שאף אחת מהן אינה
> זורקת חריגה: הטיימר מת (`email-poll-heartbeat`), ההודעה נקלטה ונשכחה
> (`email-intake-not-stuck`), או שהיכולת דלוקה בלי מה שהיא צריכה
> (`email-intake-configured`). מייל חוזר שנכשל סופית כבר מכוסה ב-
> `jobs-not-failing`, ולכן אין לו check רביעי.
>
> `email-intake-not-stuck` **אינו** מותנה בדגל, בשונה מהפעימה: כשהיכולת כבויה
> הטבלה ריקה ממילא, ואם מישהו כיבה את המתג באמצע אירוע — ההודעות שנקלטו ולא
> נענו הן עובדה שכיבוי המתג אינו מוחק. המתנה מתוכננת (`nextAttemptAt` עתידי,
> ה-backoff של כשל זמני מול Gmail) אינה נספרת בו, בדיוק כמו ב-`queue-not-stuck`.

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

> **‏`google-login-configured` (1.2) — למה `jobs-not-failing` אינו מכסה אותו.**
> ‏`jobs-not-failing` תופס תקלת תצורה **שמייצרת ג׳וב אדום**: מפתח מייל חסר
> נגלה מפני שיש עבודה שהתחייבנו לעשות והיא נכשלה. התחברות בגוגל אינה ג׳וב.
> תצורה חסרה שלה אינה מייצרת כשל, לא פעימה ישנה ולא תור תקוע — היא פשוט
> **אינה קורית**: הכפתור אינו מוצג, ואיש אינו מדווח על כפתור שלא היה.
>
> ההכרעה הייתה בין כשל באתחול השרת לבין invariant כאן, ו-invariant נבחר:
> כשל באתחול היה מפיל את ה-healthcheck (`railway.toml` → `/login`) ומגלגל
> אחורה כל פריסה שקדמה להזנת המשתנים ב-Railway. הרעש כאן זהה — issue נפרד,
> כל שש שעות — בלי להחזיק את הפריסה כבן ערובה.

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

**הדלקת קליטת המייל בפרודקשן** היא `EMAIL_INTAKE_ENABLED=1` ב-Railway, ולא
פריסה: הקוד כבר שם וכבוי. לפני ההדלקה צריכים להיות מוגדרים `GMAIL_USER`,
`GMAIL_REFRESH_TOKEN` (עם `GOOGLE_CLIENT_ID`/`SECRET`) ו-`GEMINI_API_KEY` —
אחרת `email-intake-configured` יפתח issue בסבב ה-watchdog הבא. הרשימה המלאה,
כולל `EMAIL_INTAKE_PILOT_ADDRESSES` לעלייה על שולח אחד, ב-`.env.example`.

---

## מה אומת (חי, מקומי) ומה ממתין לפריסה

**אומת חי מ-localhost אל Sentry (29.7):**
- תפיסת שגיאה (server) → אירוע ב-Sentry.
- כשל job סופי (`boom`) → הג'וב FAILED + `captureError` על המסלול הסופי.
- ה-watchdog → monitor `watchdog` נוצר; check-ins `ok` (תקין) ו-`error` (invariant שבור).

**אומת בבדיקות אינטגרציה מול DB אמיתי (18.9), לא בפרודקשן:** שלושת ה-checks
של המייל — כל אחד עובר במצב התקין וזורק במצב השבור, וכל אחד שותק כשהיכולת
כבויה (`tests/integration/watchdog.test.ts`).

**מאומת רק אחרי פריסת Railway** (דורש תהליך ארוך-חיים, App-Sleeping כבוי):
- אזעקת **missed check-in** אמיתית של ה-watchdog מעל חלון 6 שעות.
- ריצות 06:00/03:00 אמיתיות שמקדמות פעימות.
- **‏source-maps** — ‏stack traces קריאים על בניית prod (דורש `SENTRY_AUTH_TOKEN` בבנייה).
- אירועי לקוח ממכשירי שטח אמיתיים (מובייל).

מקורות אמת קשורים: `docs/deployment-status.md` · זיכרון `yy-hosting-decision-pending`.
