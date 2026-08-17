# design-sync — הערות לריפו הזה

הפרויקט ב-Claude Design: `YY Ticket Control Design System`
(`https://claude.ai/design/p/76e12f0a-bb47-45e2-bc2d-f12bb0b73b54`), מקובע ב-`config.json`.

## למה הריפו הזה חורג ממסלול ברירת המחדל של הסקיל

הסקיל בנוי סביב **חבילת רכיבים** עם `dist/` בנוי ועץ `.d.ts` שנשלח. כאן אין דבר
מזה: זו אפליקציית Next.js. שלוש ההתאמות שנובעות מכך, כולן דרך config ובלי לגעת
בקוד האפליקציה:

- **`cfg.entry` → `.design-sync/ds-entry.ts`.** מצב synth-entry של הממיר עושה
  `export *` מ**כל** קובץ `.tsx` תחת שורש המקור. תחת `src/components` זה היה גורר
  את `media-picker` (server actions + Sentry), `delete-button` ו-`inline-rename`
  (`useAction`) — כלומר את Prisma ואת כל השרת לתוך bundle דפדפן. קובץ entry מפורש
  הוא מקור האמת להיקף, ו-`componentSrcMap` מסונכרן איתו ידנית. **מוסיפים רכיב →
  לעדכן את שניהם.**
- **`cfg.tsconfig` → `.design-sync/tsconfig.ds.json`.** מרחיב את tsconfig של
  האפליקציה ומוסיף מיפוי אחד: `next/link` → `.design-sync/shims/next-link.tsx`.
  בלעדיו ה-bundle כולו נופל על `ReferenceError: process is not defined` — הרכיב
  האמיתי קורא `process.env.__NEXT_*` בזמן טעינת המודול, ואין `process` מחוץ ל-Next.
  ה-shim גם חתך את ה-bundle מ-373KB ל-216KB (‏runtime ניווט שלא ירוץ אף פעם).
- **`cfg.buildCmd` מקמפל Tailwind.** ‏`globals.css` הוא מקור (`@import "tailwindcss"`)
  ולא CSS מקומפל. `.design-sync/ds-styles.css` מייבא אותו, מוסיף `--font-heebo`
  ו-`html{direction:rtl}` (שניהם מגיעים באפליקציה מ-`layout.tsx` ולא מה-CSS), ומקומפל
  אל `.design-sync/.cache/`. **חייב לרוץ לפני הממיר בכל סנכרון.**

## פונטים

‏Heebo מגיע באפליקציה מ-`next/font/google`, ולכן אין `@font-face` לשלוח. חמשת קובצי
ה-woff2 הועתקו מ-`.next/dev/static/media/` אל `.design-sync/fonts/` (‏committed) עם
`heebo.css` שנכתב ידנית, ומחוברים דרך `cfg.extraFonts`. אלה בדיוק הקבצים שהאפליקציה
מגישה. ‏Heebo תחת OFL, ולכן ההפצה מותרת.

## safelist ב-Tailwind — אל תסירו

Tailwind v4 פולט רק מחלקות שנמצאו בסריקת המקור, כלומר גיליון שנבנה מהריפו מכיל בדיוק
את מה שהאפליקציה כבר כותבת. סוכן העיצוב ב-Claude Design בונה מסכים **חדשים**, ומחלקה
לגיטימית שהריפו לא במקרה משתמש בה (`me-2`, `pe-3`, `end-0` — כולן חסרו) הייתה נכשלת
אצלו בשקט. בלוקי `@source inline(...)` ב-`ds-styles.css` פותרים את זה; המחיר הוא
32KB → 86KB. **הסרתם תשבור כל עיצוב חדש בלי שום שגיאה.**

תחביר הווריאנטים דורש את הווריאנט **בתוך** הסוגריים עם חלופה ריקה:
`{md:,}flex` ולא `{md}:flex`. הצורה השנייה מתקמפלת בשקט ואינה פולטת כלום.

## החלטות עיצוב בתצוגות

- **`cfg.overrides.FilterBar.viewport = "420x420"`.** ברוחב דסקטופ מתג המסננים הוא
  `md:hidden`, ולכן מונה המסננים הפעילים — הסיבה שהרכיב קיים — לא נראה כלל. ברוחב
  נייד נראים גם המתג עם המונה וגם הפאנל שנפתח מאליו.
- **`Dialog` ו-`CameraCapture`: `cardMode: "single"`.** שניהם שכבה מלאה מעל המסך.
- **`TicketTable`: `cardMode: "column"`.** רחב מתא רגיל בגריד.
- **`MediaAttachments`** משתמש ב-data-URI לתמונות. במערכת הכתובת עוברת דרך route
  שבודק הרשאה, ואין לה משמעות מחוץ לאפליקציה.

## מה לא נבדק ומה נשאר פתוח

- **ההעלאה בוצעה** (161 קבצים, `_ds_sync.json` נכתב אחרון כעוגן אימות). בתחילת
  הריצה `DesignSync` נחסם על הרשאת design-system כי הסשן לא היה אינטראקטיבי;
  אם זה חוזר — `/design-login` בטרמינל אינטראקטיבי ואז לחזור.
- **הפרויקט ב-Claude Design לא נסקר בעיניים אנושיות.** הדירוג נעשה מול הרובריקה
  המוחלטת מצילומי `ds-bundle/_screenshots/review/`. שווה לפתוח את פאנל ה-DS ולוודא
  שהכרטיסים נראים שם כמו מקומית.
- **מצבים שאינם ניתנים לרינדור סטטי לא נלכדו:** הקלטה פעילה ב-`AudioRecorder`,
  תפריט פתוח ב-`LearnedSelect`/`RecipientPicker`, וזרם מצלמה חי ב-`CameraCapture`
  (מוצג במצב "מבקש גישה", שהוא מה שמשתמש רואה לפני אישור).
- **‏3 רכיבים מחוץ להיקף בכוונה:** `MediaPicker`, `DeleteButton`, `InlineRename` —
  קשורים לצד השרת. הוספתם דורשת shims ל-server actions.
- **`cardClasses`, `buttonClasses`, `chipClasses`, `controlClasses`** נמצאים ב-bundle
  אך אינם רכיבים, ולכן אין להם כרטיס. הם מתועדים בכותרת המוסכמות.

## Known render warns

אין. הריצה האחרונה: `render check: 29/29 previews render cleanly`, בלי אזהרות כלל.
אזהרה שתופיע בסנכרון הבא היא **חדשה** ודורשת בדיקה.

## Re-sync risks — מה יכול להירקב בשקט

1. **`.next/` נמחק ואין מאיפה למשוך את Heebo.** הקבצים כבר commited תחת
   `.design-sync/fonts/`, ולכן זה כבר לא סיכון — אלא אם מישהו יחליף פונט
   ב-`layout.tsx` ולא יעדכן שם. אז הסנכרון ישלח את הפונט הישן בלי להתלונן.
2. **`ds-entry.ts` ו-`componentSrcMap` מתפצלים.** רכיב שנוסף לאחד ולא לשני יוצא
   מההיקף בלי שגיאה. אין בדיקה אוטומטית לזה.
3. **טוקן חדש ב-`@theme` שאינו נכנס ל-safelist.** ה-safelist מונה את הצבעים
   בשמם; צבע סמנטי חדש (`info` וכדומה) צריך להתווסף לרשימות ידנית.
4. **`.design-sync/conventions.md` מונה שמות מפורשים** (טוקנים, מחלקות, רכיבים).
   שינוי שם במערכת הופך אותו לשקר שסוכן העיצוב יאמין לו. הסקיל מריץ אימות שמות
   מול הבנייה בכל סנכרון — לקרוא את הדוח שלו ברצינות.
5. **גרסת Tailwind.** נבנה מול `@tailwindcss/cli` 4.3.3 שמותקן ב-`.ds-sync/`
   (‏gitignored, מותקן מחדש בכל clone). שינוי major עשוי לשנות את תחביר
   ‏`@source inline`.
6. **`--node-modules ./node_modules` של הריפו עצמו.** לא הורצה התקנה נקייה
   (`npm ci`) לפני הסנכרון — node_modules הקיים שימש כמות שהוא.
