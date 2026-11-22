# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## השירות הופסק ב-22.11.2026

הפרויקט ב-Railway (האפליקציה `web` ובסיס הנתונים `Postgres`) נמחק ב-22.11.2026 לבקשת
בעל המוצר, והמנוי ל-Railway בוטל. **אין יותר פרודקשן:** מיזוג ל-`main` אינו פורס דבר,
וכל מה שכתוב ב-`AGENTS.md` על פריסה, Railway, הפרודקשן והג׳ובים שרצים בו הוא תיעוד
היסטורי. הקוד, הבדיקות וסביבת הפיתוח המקומית ממשיכים לעבוד כרגיל.

**גיבוי סופי של בסיס הנתונים בפרודקשן:** `.backups/prod-final-2026-11-22.dump` בתיקיית
הפרויקט, **במחשב הזה בלבד** (התיקייה מוחרגת מ-git). פורמט custom של `pg_dump` מ-PostgreSQL
18.6, 29 טבלאות, נלקח דקות לפני המחיקה. שחזור:
`pg_restore -d <db> --no-owner --no-privileges .backups/prod-final-2026-11-22.dump`.
גיבויים יומיים ישנים יותר נמצאים ב-bucket הגיבויים ב-Cloudflare R2 תחת `db/`, כל עוד
החשבון שם קיים. קובצי המדיה עצמם נשארו ב-bucket המדיה ב-R2 ולא גובו מחדש.

@AGENTS.md
