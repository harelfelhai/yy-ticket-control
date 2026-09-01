# תמונת הריצה של הפרודקשן.
#
# **למה Dockerfile ולא Railpack.** הבנאי הקודם התקין `postgresql-client`
# מהמאגר של תמונת הבסיס, ומה שהיא נותנת הוא הגרסה שהיא נותנת — 15, ואחר כך
# 17. שירות ה-Postgres ב-Railway רץ על **18**, ו-`pg_dump` מסרב לגבות שרת
# חדש ממנו. התוצאה נמדדה בפועל: **32 ג'ובי גיבוי כושלים ברצף**, כל אחד עם
# `aborting because of server version mismatch`, ואף גיבוי אחד שהצליח.
#
# ‏`aptPackages` של Railpack אינו יכול להוסיף מאגר apt, ולכן אין דרך להגיע
# ל-18 דרכו. כאן אנחנו מוסיפים את מאגר PGDG הרשמי ומקבעים את הגרסה. זהו
# ה-fallback שכבר תועד ב-`docs/deployment-status.md` §7 כמוצא לתרחיש הזה.
#
# **המחיר, במפורש:** כל שרשרת הבנייה עוברת לאחריותנו, ואי אפשר לאמת אותה
# במכונת הפיתוח — אין בה Docker. האימות היחיד הוא הפריסה עצמה, ואחריה
# ‏`npm run smoke:prod` וריצת גיבוי אמיתית.

FROM node:22-bookworm-slim

# ── לקוח Postgres 18 ממאגר PGDG ──────────────────────────────────────────
# הגרסה מקובעת במפורש (`postgresql-client-18`) ולא נגררת: לקוח שמשתדרג לבד
# הוא בדיוק אותה תקלה בכיוון ההפוך. שדרוג עתידי של השרת מחייב לגעת כאן —
# וזה רצוי, כי אז השורה הזו היא המקום היחיד שצריך לזכור.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y curl gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── תלויות ───────────────────────────────────────────────────────────────
# ‏`prisma/` ו-`prisma.config.ts` מועתקים **לפני** ההתקנה, מפני ש-`postinstall`
# מריץ `prisma generate` והוא קורא את שניהם.
#
# בלי `NODE_ENV=production` כאן, ובכוונה: הבנייה זקוקה ל-devDependencies
# (‏typescript, tailwindcss, ‏@tailwindcss/postcss). ‏`NODE_ENV` נקבע לריצה
# בסוף הקובץ.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

COPY . .

# ‏`src/generated/prisma` **אינו בגיט** (`.gitignore:37`), ולכן הוא אינו קיים
# בהקשר הבנייה. ה-`postinstall` שלמעלה כבר ייצר אותו, אבל `COPY . .` שאחריו
# עלול להסתיר אותו בסביבות שבהן ההקשר כן מכיל תיקייה ישנה. ייצור מפורש כאן
# מסיר את התלות בסדר, במחיר של כמה שניות.
RUN npx prisma generate

# ── משתני זמן בנייה ──────────────────────────────────────────────────────
# ‏Railway מזריק את משתני השירות לבנייה כ-build args, אך רק `ARG` מפורש
# חושף אותם. **‏`NEXT_PUBLIC_SENTRY_DSN` הוא הקריטי**: הוא נצרב לתוך חבילת
# הלקוח בזמן `next build`, ובלעדיו Sentry בדפדפן שותק בלי להתלונן.
# השלושה של Sentry דרושים להעלאת source-maps; בלעדיהם הפלאגין מדלג בשקט
# ו-stack traces בפרודקשן חוזרים להיות בלתי-קריאים.
ARG DATABASE_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV DATABASE_URL=$DATABASE_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── ריצה ─────────────────────────────────────────────────────────────────
# ‏`start:prod` הוא `next start` בלי `-p`, ולכן הוא מאזין על `PORT` ש-Railway
# מזריק. ‏`npm start` נעול לפורט 3100 של הפיתוח ואסור לשימוש כאן.
#
# ‏devDependencies נשארות בתמונה: `preDeployCommand` מריץ `prisma migrate
# deploy`, ו-`prisma` אמנם תלות ריצה — אבל גיזום כאן היה חוסך מאות
# מגה-בייט במחיר סיכון שאי אפשר לאמת בלי Docker במכונה. לא עכשיו.
ENV NODE_ENV=production
CMD ["npm", "run", "start:prod"]
