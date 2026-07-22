# בקרת פניות — Y&Y

מערכת לניהול פניות תיקונים באתרי בנייה: פתיחת פנייה מהשטח, שיוך לקבלני משנה חיצוניים
דרך קישור אישי, מעקב אחר סטטוס לכל נמען, ותמונת מצב אחת של מה שדורש טיפול.
מחליפה ניהול בקבוצות וואטסאפ, שבו פניות התפספסו ולא הייתה תמונת מצב.

## מסמכים

| מסמך | תפקיד |
|---|---|
| [`docs/specs/ticket-control-pre-plan.md`](docs/specs/ticket-control-pre-plan.md) | **אפיון פונקציונלי — מקור האמת.** כל שאלה על התנהגות, מסך, נוסח או חוק עסקי מוכרעת שם |
| [`docs/מסמך-אפיון-מקורי.docx`](docs/) | מסמך הדרישות המקורי שכתב המנהל בחברה |
| [`AGENTS.md`](AGENTS.md) | מוסכמות פיתוח + שינויים שוברים ב-Next.js 16 |

## הרצה מקומית

```bash
npm install
npm run dev      # http://localhost:3100
```

| פקודה | מה היא עושה |
|---|---|
| `npm run dev` | שרת פיתוח (פורט 3100) |
| `npm run build` | בנייה לפרודקשן |
| `npm run start` | הרצת הבנייה |
| `npm run lint` | ESLint |
| `npm run typecheck` | בדיקת טיפוסים ללא בנייה |

## סטאק

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS v4 · Prisma + PostgreSQL ·
אירוח ב-Railway · מדיה ב-Cloudflare R2.

הממשק עברית ו-RTL בלבד, mobile-first (עבודת שטח), עם תמיכה מלאה בדסקטופ.
