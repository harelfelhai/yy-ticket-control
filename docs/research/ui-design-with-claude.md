# עיצוב UI טוב בפרויקטים שנבנים עם Claude Code

> מסמך מחקר, 30.7.2026. סוקר איך הקהילה פותרת היום את בעיית "העיצוב הגנרי" של סוכני קוד,
> ומתרגם את זה לתוכנית פעולה קונקרטית ל-`yy-ticket-control`.

---

## תקציר מנהלים

הבעיה אמיתית ומוכרת, ויש לה שם: **AI slop**. היא לא נובעת מחוסר "כישרון" של המודל אלא
ממנגנון ההסקה שלו — מודל שפה מייצר את ההמשך הסביר ביותר, ו"הסביר ביותר" הוא בדיוק ההגדרה
של עיצוב ממוצע. הפתרון שהתגבש בקהילה במהלך 2026 אינו "לבקש יפה יותר", אלא **להסיר את
העיצוב מתחום ההחלטות של הסוכן בזמן כתיבת קוד** ולהעביר אותו לשלוש שכבות נפרדות:

| שכבה | מה היא פותרת | העלות |
|---|---|---|
| **מקור אמת עיצובי** (`DESIGN.md` + טוקנים) | הסוכן מפסיק להמציא צבע/מרווח/גודל בכל קומפוננטה | חד-פעמי, ~יום עבודה |
| **לולאת פידבק ויזואלית** (Playwright MCP + screenshots) | הסוכן רואה מה הוא בנה, במקום לנחש | ~15 דק' הקמה, עלות טוקנים שוטפת |
| **ביקורת עיצוב אוטומטית** (design-review subagent) | תופס רגרסיות עיצוביות כמו שבדיקות תופסות באגים | ~שעה הקמה |

**המסקנה המרכזית והלא-אינטואיטיבית:** רוב העצות ברשת בנושא ("אל תשתמש ב-Inter", "טיפוגרפיה
אקספרסיבית", "אסימטריה ושבירת גריד") נכתבו עבור **דפי נחיתה ואתרי שיווק**. עבור מערכת ניהול
פנימית וצפופת-מידע — וזה בדיוק `yy-ticket-control` — חלק גדול מהן **מזיק**. שם ההצלחה נמדדת
בצפיפות מידע, סריקוּת, ועקביות אכזרית — לא בייחודיות. פירוט בפרק 1.3.

---

## פרק 1 — למה הפלט נראה גנרי

### 1.1 המנגנון

סוכן קוד מאומן לייצר את הקוד הנכון-ביותר-בסבירות עבור בקשה. בקוד לוגי זו תכונה מצוינת: יש
בדרך כלל דרך נכונה אחת. בעיצוב זו התכונה שהורסת — כשמבקשים "עמוד תמחור", מה שמתקבל הוא
עמוד התמחור הממוצע-סטטיסטית של האינטרנט. הבעיה אינה חוסר יכולת אלא **היעדר אילוץ**:
[superdesign.dev](https://superdesign.dev/blog/claude-code-ui-design) מנסח את זה כ"the
statistically-average pricing page is what you get".

מכאן נובע גם למה `"תעשה שזה לא ייראה כמו AI"` לא עובד: זו הנחיה שלילית ללא כיוון חלופי.
המודל צריך **מחויבות לכיוון** לפני שהוא כותב את הטוקן הראשון של CSS.

### 1.2 החתימה הוויזואלית — והעובדה שהיא זזה

הסימנים המוכרים מ-2024–2025:

- גופן ברירת מחדל (Inter / Roboto) ללא וריאציית משקל
- גרדיאנט סגול־אינדיגו על רקע לבן
- שלושה כרטיסים מעוגלים זהים בשורה
- כפתור primary כחול גנרי
- מרווח 16px אחיד בכל מקום, ללא ריתמוס
- glassmorphism ו-`shadow-lg` על הכול
- היעדר מוקד ויזואלי אחד

**חשוב:** הרשימה הזו מתיישנת. ריכוז ה"טעמים ההפוכים" שהקהילה אימצה כתגובה יצר חתימה חדשה.
[awesome-claude-design](https://github.com/rohitg00/awesome-claude-design) מתעד את הביקורת
על הפלט של Claude Design ב-2026: *"identical aesthetic fingerprints: teal accents, blinking
status dots, container nesting, serif headlines, left-bar cards, three-column grids"*.

המסקנה המתודולוגית: **אין רשימת אנטי-פטרנים נצחית.** מה שמחזיק לאורך זמן הוא לא הרשימה אלא
המנגנון — מקור אמת עיצובי ספציפי לפרויקט, שאינו נגזר מהממוצע.

### 1.3 האזהרה: רוב העצות ברשת לא מיועדות למערכת כמו שלנו

זה הפער החשוב ביותר במסמך הזה. כמעט כל התוכן בנושא "איך לגרום ל-Claude לעצב יפה" עוסק
בדפי נחיתה, portfolio ו-SaaS marketing. ההנחיות האופייניות שם:

- טיפוגרפיה בניגודיות קיצונית (משקל 200 מול 800, קפיצה של פי 3 בין רמות)
- אסימטריה, שבירת גריד, "signature element"
- מרחב שלילי נדיב
- מוקד ויזואלי אחד לעמוד
- אנימציות scroll-triggered

עבור לוח פניות שמנהל עבודה סורק בשמש עם כפפות, כל אחת מהן היא נזק ישיר. מחקר צפיפות מידע
מראה ש[עלות האינטראקציה של הפשטה יכולה לקזז או לעלות על שיפור השימושיות](https://blog.logrocket.com/balancing-information-density-in-web-development/)
— כלומר "פחות על המסך" מתורגם ל"יותר קליקים" למשתמש מומחה שעושה את אותה פעולה 50 פעם ביום.
[Matt Ström](https://mattstromawn.com/writing/ui-density/) מפריד בין *צפיפות ויזואלית*
(כמה דיו על המסך) ל*צפיפות מידע* (כמה ידע מועבר) — כלים פנימיים טובים מקסמים את השנייה.

**התרגום המעשי:** יש לאמץ מהמחקר את שכבת ה**מנגנון** (מקור אמת, לולאה ויזואלית, ביקורת),
ולדחות את שכבת ה**טעם** שמיובאת מעולם דפי הנחיתה. לפי [superdesign](https://superdesign.dev/blog/claude-code-ui-design)
עצמם, ההפרדה מוצדקת: הם ממליצים לדלג על גישת סוכן-העיצוב עבור "internal-only admin tools
nobody external sees".

---

## פרק 2 — תהליך העבודה

זה החלק בעל ההחזר הגבוה ביותר. הכלים משתנים; התהליך יציב.

### 2.1 שלב 0 — הפרדה מבנית

העיקרון: **החלטה עיצובית לא מתקבלת בזמן כתיבת קוד.** בפועל זה מתבטא בשני מהלכים נפרדים:

1. **מהלך עיצוב** — הסוכן מייצר מערכת קומפקטית (פלטה, סקאלת טיפוגרפיה, ריתמוס מרווחים,
   רכיב חתימה), מבקר אותה מול הבריף, ורק אז מקבע.
2. **מהלך הנדסי** — כתיבת קוד שצורכת את המערכת הקבועה, ללא רשות להמציא ערכים.

זה בדיוק המבנה של ה-skill הרשמי `frontend-design` של Anthropic: תהליך
*Brainstorm → Explore → Plan → Critique → Build* ([DeepWiki](https://deepwiki.com/anthropics/claude-code/4.6-frontend-design-plugin)).

### 2.2 שלב 1 — מקור אמת עיצובי בקובץ

הפורמט שהתגבש כתקן דה-פקטו הוא **`DESIGN.md`**. Google Labs פרסמו אותו כספק פתוח תחת
Apache 2.0 ב-21.4.2026, מנותק מ-Stitch, כך שכל סוכן יכול לצרוך אותו
([google-labs-code/design.md](https://github.com/google-labs-code/design.md)).

מבנה: **YAML front matter** (טוקנים מכונה-קריאים) + **גוף Markdown** (הרציונל).

```markdown
---
version: 1
name: Y&Y Ticket Control
colors:
  brand: "#1d4ed8"
  danger: "#b91c1c"
typography:
  body: { fontFamily: Heebo, fontSize: 16px, lineHeight: 1.5 }
spacing:
  base: 4px
components:
  chip: { background: "{colors.brand}", rounded: "{rounded.full}" }
---

## Colors
...
## Do's and Don'ts
...
```

סעיפים מוגדרים בסדר קבוע: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
Components, Do's and Don'ts. הפניות בין טוקנים בתחביר `{path.to.token}`.

ה-CLI נותן ארבע פקודות שהופכות את זה לנכס תחזוקתי ולא לעוד קובץ שמתיישן:

```bash
npx @google/design.md lint    # 11 חוקי ולידציה: הפניות שבורות, יחסי ניגודיות (WCAG), טוקנים יתומים, סדר סעיפים
npx @google/design.md diff    # השוואה בין גרסאות — תופס רגרסיות עיצוביות
npx @google/design.md export  # ייצוא ל-Tailwind (JSON/CSS) או W3C DTCG
npx @google/design.md spec    # פלט הספק עצמו, להזרקה לפרומפט
```

**למה זה עדיף על טוקנים לבד:** Shadcnblocks מנסחים את זה מדויק —
[*"tokens alone are not enough… coding agents still guess at hierarchy, density, and taste"*](https://www.shadcnblocks.com/blog/shadcn-theme-design-md).
משתני CSS אומרים לסוכן *מה הערך*; `DESIGN.md` אומר לו *מתי להשתמש בו* — היררכיה, ריתמוס,
ואנטי-פטרנים שספציפיים למוצר. סעיף "Do's and Don'ts" הוא לרוב הסעיף בעל ההשפעה הגדולה ביותר.

הספק עדיין ב-`alpha`. זה לא חוסם — אפשר לאמץ את המבנה גם בלי להתחייב לכלים.

### 2.3 שלב 2 — Reference grounding

הממצא החוזר בכל המקורות: **תמונה מנצחת פרוזה.** במקום לתאר טעם במילים, נותנים לסוכן יעד
קונקרטי — צילום מסך של מערכת קיימת, או המערכת שלנו עצמה במצב הנוכחי. הכלי
[brandmd](https://github.com/rohitg00/awesome-claude-design) עושה את המהלך אוטומטית: חילוץ
`DESIGN.md` מאתר חי דרך CLI.

עבור מערכת פנימית, ה-reference הנכון אינו Linear או Stripe אלא **מערכות תפעול צפופות**:
לוחות בקרה תעשייתיים, ממשקי dispatch, Jira/Linear במצב table view.

### 2.4 שלב 3 — הלולאה הוויזואלית (החלק הקריטי)

הבעיה: **Claude לא רואה את הפלט שלו.** הוא כותב CSS ומנחש איך זה נראה. Playwright MCP סוגר
את הלולאה.

הקמה, ב-user scope:

```bash
claude mcp add playwright -- npx @playwright/mcp@latest
```

ואז מוסיפים ל-`CLAUDE.md` את מחזור העבודה
([ap7i.com](https://ap7i.com/posts/giving-claude-code-eyes-with-playwright-mcp/)):

1. בצע את שינוי הקוד
2. נווט לעמודים המושפעים
3. צלם ב-viewport היעד
4. השווה מול עקרונות העיצוב המתועדים
5. קרא את ה-console לשגיאות
6. זהה פערים ותקן
7. אמת מחדש

זה מחליף את הצוואר בקבוק הידני — *לשנות → לבנות → להחליף חלון → לבדוק → לתאר את הבעיה
במילים → לחכות → לחזור*. בפועל, מה שהופך את זה לעובד הוא שהמשתמש יכול לומר "הטופס צר מדי"
והסוכן מבין, כי הוא רואה את אותו טופס.

**עלות — לא להתעלם:** טעינת ~30 סכמות כלים של Playwright MCP צורכת חלון הקשר באופן שוטף,
ועצי הנגישות שהוא מחזיר מפורטים. במאגר Playwright MCP עצמו מציינים שזרימות מבוססות-CLI
חסכוניות יותר. עבור פרויקט זה, שכבר מריץ Playwright כ-`@playwright/test`, קיימת חלופה
זולה יותר: **סקריפט צילום ייעודי** ש-Claude מריץ דרך Bash ואז קורא את ה-PNG בכלי `Read`.
אותה לולאה, בלי עלות הסכמות הקבועה. ראו פרק 6.

### 2.5 שלב 4 — ביקורת עיצוב אוטומטית

הדפוס הבשל ביותר בקהילה הוא של
[OneRedOak/claude-code-workflows](https://github.com/OneRedOak/claude-code-workflows/tree/main/design-review):
subagent ייעודי + slash command `/design-review` שקורא את ה-git diff, מפעיל דפדפן, ומחזיר
פידבק מובנה על זרימות אינטראקציה, רספונסיביות, ליטוש ויזואלי, נגישות, עמידות ובריאות קוד.

ארבעת הקבצים בתבנית:

| קובץ | תפקיד |
|---|---|
| `CLAUDE.md` | הנחיות פיתוח ויזואלי — מתי להריץ את הלולאה |
| `context/design-principles.md` | העקרונות שמולם מבקרים |
| `context/style-guide.md` | הטוקנים |
| `.claude/agents/design-reviewer.md` | הסוכן המבקר |

הרעיון החשוב: **זה עובד בדיוק כמו בדיקות אוטומטיות.** רגרסיה עיצובית נתפסת בזמן השינוי,
לא שלושה שבועות אחריו. זה מתיישב ישירות עם הכלל "בדיקות אחרי כל רכיב" שכבר נהוג בפרויקט.

⚠️ ה-`design-principles-example.md` שלהם הוא צ'קליסט "S-Tier SaaS Dashboard" — טוב מאוד
כשלד, אבל בנוי סביב הנחות SaaS (dark mode, סרגל צד קבוע, גריד 12 עמודות). יש לגזור ממנו
גרסה מותאמת, לא לאמץ כמו שהוא.

### 2.6 שלב 5 — ואריאציות במקום איטרציה

דפוס שחוזר במקורות: במקום לשפר ניסיון אחד שוב ושוב, מייצרים **3–5 כיוונים עצמאיים** ובוחרים.
Superdesign בונה על זה (canvas אינסופי עם ואריאציות מסתעפות), ובחבילות הפרומפטים של
awesome-claude-design יש `3-designer-debate` ו-`family-picker`. הסיבה שזה עובד: איטרציה
מנקודת מוצא ממוצעת מתכנסת לממוצע משופר; דגימה מקבילה חושפת את מרחב האפשרויות.

---

## פרק 3 — פרומפטינג ו-skills

### 3.1 היררכיית השכבות

התגבשה חלוקה בת שלוש-ארבע שכבות
([DEV](https://dev.to/aws-builders/agentsmd-skillmd-designmd-how-ai-instructions-split-into-three-layers-d0g)):

| קובץ | תחום | טווח |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | חוקי הפרויקט — סטאק, מוסכמות, איך מריצים | תמיד בהקשר |
| `SKILL.md` | *איך* לעשות סוג-עבודה מסוים | נטען לפי הצורך |
| `DESIGN.md` | *איך זה צריך להיראות* — טוקנים + רציונל | נטען כשנוגעים ב-UI |

**המלצה:** לא לדחוס עיצוב לתוך `CLAUDE.md`. קובץ הקשר תמידי שמתנפח פוגע בכל שאר העבודה.
מפנים אליו: `כשנוגעים ב-UI, קרא קודם docs/DESIGN.md`.

### 3.2 ה-skill הרשמי `frontend-design`

זמין כפלאגין רשמי של Anthropic (claude.com/plugins/frontend-design) — **וכבר זמין בסשן הזה**.
זהו קובץ `SKILL.md` יחיד, ~1,300 טוקנים, ללא agents או commands
([מקור](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design)).

מה שהוא באמת עושה: מכריח **מחויבות לכיוון אסתטי לפני קוד**. הוא מציב את הסוכן כ"design lead
בסטודיו בוטיק", דורש עיגון בנושא עצמו ("what is the product, who is the audience"), ומוסיף
מעבר ביקורת עצמית מול הבריף. עקרונות מרכזיים: טיפוגרפיה כאישיות ולא כרכב ניטרלי, "structural
honesty" (מספור 01/02/03 רק כשהסדר נושא מידע אמיתי), משמעת תנועה, וקופי כחומר עיצובי.

מה שהוא **לא** עושה: לא רואה את הפלט, לא מכיר את המוצר שלך, לא נותן עקביות בין סשנים,
ולא מתאים למערכות פנימיות צפופות — ההטיה שלו היא לכיוון אקספרסיבי. הוא שכבת *טעם*, לא
שכבת *מערכת*. שווה להפעיל בשלב תכנון עיצוב חדש; פחות שווה בעבודה שוטפת על מסך קיים.

### 3.3 מבנה הפרומפט: Default → Constraint

הדפוס האפקטיבי ביותר מורכב משלושה חלקים: **מה לאסור** → **מה לחייב** → **עוגן השוואתי**.

דוגמה מ-[superdesign](https://superdesign.dev/blog/claude-code-ui-design):

> "Design an analytics dashboard… **Avoid:** Inter font, purple gradient, three-identical-cards
> row. **Use:** one dominant color plus accent, clear typographic hierarchy, strong focal
> metric. **Closer to** Linear or Vercel than templates."

ולאיטרציה:

> "Take this draft and push it darker and more premium. Tighten vertical rhythm to an 8px
> system, increase type-scale contrast (300 vs 800 weight), add one deliberate accent moment."

הפואנטה: **אנטי-פטרנים מפורשים עובדים; הנחיות עמומות לא.** "אל תיראה כמו AI" חסר תוכן;
"אסור גרדיאנט סגול, אסור שלושה כרטיסים זהים" ניתן לאכיפה.

### 3.4 אנטי-פטרן: לבקש עיצוב בלי לקבע אותו

הכשל החוזר ביותר הוא לקבל מסך יפה בסשן אחד, ולגלות שהמסך הבא — באותו פרויקט — נראה אחרת.
זה לא כשל של המודל אלא של הארכיטקטורה: אם ההחלטות לא נכתבו לקובץ, הן לא קיימות. **כל סשן
עיצוב חייב להסתיים בכתיבה ל-`DESIGN.md`.**

---

## פרק 4 — סטאק וכלים

### 4.1 מפת הכלים

| כלי | מה הוא | שווה? |
|---|---|---|
| **`frontend-design`** (Anthropic) | SKILL.md רשמי, חינם, ~565K התקנות | ✅ כן — עלות אפס. שכבת טעם, לא מערכת |
| **`DESIGN.md`** (Google Labs) | ספק פתוח + CLI (lint/diff/export) | ✅ כן — הרכיב היחיד שנותן עקביות בין סשנים |
| **Playwright MCP** | עיניים לסוכן | ✅ העיקרון חובה. המימוש — לשקול סקריפט במקום MCP |
| **design-review subagent** | ביקורת עיצוב על ה-diff | ✅ כן — ROI גבוה, הקמה קצרה |
| **shadcn/ui** | פרימיטיבים מבוססי Radix שאתה בעלים שלהם | ⚠️ תלוי — ראו 4.2 |
| **Claude Design + `/design-sync`** | מערכת עיצוב מנוהלת ב-claude.ai, סנכרון דו-כיווני לקוד | ⚠️ מוצר טוב, ביקורת על מחיר טוקנים |
| **tweakcn / shadcnblocks / better-design** | ערכות נושא מוכנות + `DESIGN.md` נלווה | 🔸 קיצור דרך אם מאמצים shadcn |
| **v0 MCP / Superdesign / Stitch** | ייצור UI חיצוני | 🔸 טוב לחקר כיוונים, לא לתחזוקה |
| **rtlify-ai** | תיקון והנחיית RTL לסוכנים | ✅ רלוונטי ישירות — פרק 5 |

### 4.2 shadcn/ui — הטיעון האמיתי

הטיעון בעד אינו "רכיבים יפים" אלא **צמצום מרחב ההחלטה**. סוכן שכותב Tailwind גולמי מול
מסך ריק בוחר מתוך אינסוף; סוכן שמרכיב פרימיטיבים קיימים בוחר מתוך קבוצה סופית.
[Refine](https://refine.dev/blog/shadcn-blog/) מנסחים: הסוכן לומד את הדפוס מהרכיבים
הקיימים ומיישם אותו על חדשים. וכשהטוקנים מוגדרים ב-`@theme`, **מחלקות ה-utility עצמן
מוגבלות לטוקנים** — הסחיפה נחסמת ברמת הכלי, לא ברמת המשמעת.

הטיעון נגד, במקרה שלנו: הפרויקט כבר מריץ Tailwind v4 עם `@theme` נקי, בעברית ו-RTL בלבד,
עם רכיבים ידניים סבירים. הכנסת shadcn/ui היא מיגרציה לא-קטנה, ורכיבי Radix דורשים בדיקת
התנהגות RTL בפועל. **החלופה הזולה:** להשיג את אותו אפקט בלי הספרייה — לחלץ 5–7 פרימיטיבים
מקומיים (`Button`, `Input`, `Field`, `Card`, `Chip`, `Table`, `EmptyState`) מהקוד הקיים,
ולאסור ב-`AGENTS.md` שימוש ב-Tailwind גולמי לרכיבים שיש להם פרימיטיב.

### 4.3 Claude Design ו-`/design-sync`

עדכון יוני 2026 הוסיף ייבוא מערכות עיצוב (מ-GitHub/קובץ/העלאה), עריכת WYSIWYG על canvas,
ופקודת `/design-sync` שמסנכרנת בין הפרויקט ב-claude.ai לספריית רכיבים מקומית — רכיב-רכיב,
לא החלפה גורפת ([ChatForest](https://chatforest.com/builders-log/claude-design-june-2026-design-system-imports-code-sync-token-fix-builder-guide/)).
היכולת זמינה בסשן הזה.

הביקורת מהקהילה עקבית: **צריכת טוקנים גבוהה** (מעצב אחד דיווח על 50% מהמכסה השבועית על
מערכת + פרוטוטייפ אחד), ו**חתימה אסתטית אחידה** לפלט. מצד שני, פיצ'ר ה-comment-on-element
מכסה לפי הדיווחים ~95% מצרכי האיטרציה. ההערכה הרווחת: מחליף עבודת comps של ג'וניור, לא
מעצב מקצועי.

**המלצה למערכת פנימית:** לא נדרש. `DESIGN.md` + לולאה ויזואלית נותנים את רוב הערך בשבריר
העלות. שווה לשקול אם וכשיהיה מסך פונה-חוץ (דף נחיתה, פורטל לקוחות).

---

## פרק 5 — RTL ועברית: הפער שהמחקר הכללי מפספס

זה תחום שבו הסוכנים נכשלים באופן שיטתי, וזה **הפער בעל ההשפעה הגבוהה ביותר בפרויקט הזה**.
הסיבה מבנית: מאגרי האימון הם LTR כמעט לחלוטין, ולכן ברירת המחדל של המודל היא CSS פיזי.
[הניתוח של Idan Levi](https://dev.to/idanlevi1/ai-coding-agents-are-great-but-they-suck-at-rtl-heres-how-i-fixed-it-2g0g)
מפרט שישה כשלים חוזרים:

**1. מחלקות פיזיות במקום לוגיות** — הכשל הנפוץ ביותר:

| שגוי | נכון |
|---|---|
| `ml-4` | `ms-4` |
| `pr-6` | `pe-6` |
| `text-left` | `text-start` |
| `border-l-2` | `border-s-2` |
| `rounded-tl-lg` | `rounded-ss-lg` |
| `float-right` | `float-end` |
| `left-0` | `start-0` |

**2. מספרים שקופצים בטקסט דו-כיווני** — `<p>ההזמנה שלך #12345 אושרה</p>` יציג את המספר
במקום הלא נכון. הפתרון: `<bdi>#12345</bdi>`. רלוונטי ישירות למספרי דירה, מספרי פנייה,
שמות מותג ותאריכים בתוך משפט עברי.

**3. אייקוני כיוון** — חץ "הבא" חייב `rtl:-scale-x-100`. אייקון "בית" או "הגדרות" — לא.

**4. פורמט מספרים ותאריכים** — `Intl.NumberFormat('he-IL', …)` במקום שרשור ידני.

**5. רכיבים מורכבים** (carousel, slider) — דורשים `dir="rtl"` מפורש.

**6. React Native** — לא רלוונטי כאן.

הכלי `rtlify-ai` מאוטמט את זה: `npx rtlify-ai init` כותב `.rtlify-rules.md` ומזריק הפניה
ל-`CLAUDE.md`; `check` סורק ומחזיר exit code 1 (מתאים ל-CI); `fix` מייצר פרומפט תיקון.

**ממצא בפרויקט:** סריקה של `src/` העלתה **29 מופעים של מחלקות כיווניות פיזיות ב-13 קבצים**.
לא כולם באגים — חלקם מכוונים או ניטרליים — אבל זה מספר שדורש מעבר.

הערה: Tailwind 4.2 (18.2.2026) הרחיב את מובאות ה-logical properties.

---

## פרק 6 — תוכנית פעולה ל-`yy-ticket-control`

### 6.1 המצב הקיים — הערכה

בדקתי את `globals.css`, `AGENTS.md`, ורכיבים מייצגים. **הבסיס טוב יותר ממה שהציפייה של
"עיצוב Claude גנרי" מרמזת**, ואין כאן AI slop קלאסי:

✅ **מה עובד:**
- שכבת טוקנים אמיתית ב-`@theme` של Tailwind v4 (`--color-brand`, `--color-danger`…)
- הצבע נגזר **ממשמעות ולא מאסתטיקה** — `status-chip.tsx` ממפה סטטוס→משמעות→צבע. זו בדיוק
  הדיסציפלינה הנכונה לכלי תפעולי
- החלטות עיצוב מנומקות בהערות (למה אין dark mode, למה הכרטיס כולו קישור)
- אילוץ אמיתי ומועיל: עבודת שטח → ניגודיות גבוהה, אזורי מגע נדיבים
- ריכוז מחרוזות ב-`he.ts` — מקור אמת אחד

❌ **מה חסר, ובאיזה סדר חשיבות:**

| # | פער | השפעה |
|---|---|---|
| 1 | 29 מחלקות כיווניות פיזיות ב-13 קבצים | באגי פריסה בפועל ב-RTL |
| 2 | אין `DESIGN.md` — הרציונל קיים בהערות מפוזרות בלבד | כל סשן חדש ממציא מחדש |
| 3 | אין סקאלת טיפוגרפיה מוגדרת — `text-sm`/`text-xs` בפיזור | היררכיה שטוחה; המסך "עמום" |
| 4 | אין פרימיטיבים (Button/Input/Field/Table) — 18 עמודים בונים ידנית | הסחיפה שכבר קיימת תחריף |
| 5 | אין סקאלת מרווחים מקובעת (`gap-1.5`, `p-4`, `py-0.5` אד-הוק) | היעדר ריתמוס אנכי |
| 6 | אין הגדרת focus-visible / states גלובלית | נגישות מקלדת |
| 7 | אין לולאה ויזואלית — Playwright קיים אבל רק ל-e2e | הסוכן עדיין עיוור |
| 8 | אין `.claude/agents/` — אין ביקורת עיצוב | רגרסיות לא נתפסות |

**האבחנה המרכזית:** הבעיה כאן אינה "חוסר יופי" אלא **היעדר קיבוע**. יש טעם טוב שאינו כתוב
בשום מקום שהסוכן קורא — ולכן הוא נשחק בכל סשן.

### 6.2 הצעדים, לפי סדר ROI

**שלב 1 — קיבוע (יום עבודה, ההחזר הגבוה ביותר)**

1. `docs/DESIGN.md` בפורמט Google Labs. לחלץ את הרציונל שכבר קיים בהערות הקוד (למה אין
   dark mode, למה צבע נגזר ממשמעות, למה כרטיס = קישור אחד) ולהפוך אותו לסעיף
   **Do's and Don'ts** מפורש. זה הסעיף שהסוכן באמת מציית לו.
2. להשלים ב-`@theme` את מה שחסר: סקאלת טיפוגרפיה (4–5 רמות עם משקלים מוגדרים), סקאלת
   מרווחים על בסיס 4px, `--radius-*`, ורמת elevation אחת או שתיים.
3. הפניה ב-`AGENTS.md`: `כשנוגעים ב-UI — קרא קודם docs/DESIGN.md`.
4. `npx @google/design.md lint` — כולל ולידציית ניגודיות WCAG, רלוונטית במיוחד לקריאוּת בשמש.

**שלב 2 — RTL (חצי יום, מתקן באגים אמיתיים)**

5. `npx rtlify-ai init` + `check`, ולעבור על 29 המופעים. חלקם לגיטימיים — לא להמיר עיוורת.
6. להוסיף ל-`AGENTS.md` את טבלת המיפוי הפיזי→לוגי כחוק קשיח.
7. `<bdi>` סביב מספרי דירה/פנייה/תאריכים בתוך משפטים עבריים ב-`he.ts`.
8. `rtlify-ai check` כשלב ב-`npm run verify` — זה הופך את זה לבדיקה אוטומטית שנשארת
   בפרויקט, בהתאם למוסכמות הקיימות.

**שלב 3 — לולאה ויזואלית (חצי יום)**

9. `scripts/screenshot.mts` — סקריפט Playwright שמצלם רשימת מסלולים מוגדרת בשני viewports
   (נייד בשטח + דסקטופ) ל-`.screenshots/`. **מעדיף את זה על Playwright MCP** בגלל עלות
   הסכמות, ובגלל ש-Playwright כבר מותקן כאן.
10. חוק ב-`AGENTS.md`: אחרי שינוי UI — להריץ את הסקריפט, לקרוא את ה-PNG, ולהשוות מול
    `DESIGN.md` לפני דיווח "בוצע". זה יישום ישיר של הכלל הקיים "הרצה בפועל, לא רק בדיקות".

**שלב 4 — פרימיטיבים (1–2 ימים)**

11. לחלץ `Button`, `Input`, `Field`, `Card`, `Chip`, `Table`, `EmptyState` ל-`src/components/ui/`.
    לא shadcn — חילוץ מהקוד הקיים, שמונע מיגרציה ובודק RTL בדרך.
12. חוק ב-`AGENTS.md`: אין Tailwind גולמי לרכיב שיש לו פרימיטיב.
13. בדיקות יחידה לכל פרימיטיב כולל מצבי focus/disabled/error.

**שלב 5 — ביקורת אוטומטית (שעה)**

14. `.claude/agents/design-reviewer.md` בהשראת OneRedOak, מותאם: הצ'קליסט שלהם הוא
    S-Tier SaaS ומניח dark mode וסרגל צד — לגזור גרסה לכלי שדה צפוף.
15. `/design-review` שקורא git diff, מריץ צילומים, ומחזיר פערים מול `DESIGN.md`.

### 6.3 מה **לא** לעשות

- ❌ **לא** לאמץ את עצות ה"anti-slop" האקספרסיביות (טיפוגרפיה דרמטית, אסימטריה, שבירת גריד,
  אנימציות scroll). זה כלי שדה. עקביות > ייחודיות.
- ❌ **לא** להחליף את Heebo בגופן "מעניין". בעברית מרחב הגופנים הקריאים צר בהרבה מאנגלית,
  ו-Heebo היא בחירה נכונה לניגודיות גבוהה. הבעיה בטיפוגרפיה כאן היא **היעדר סקאלה**, לא
  הגופן.
- ❌ **לא** לפתוח dark mode. ההחלטה מנומקת ב-`globals.css` ונכונה — היא חוסכת תחזוקה של שתי
  ערכות לכל מצב סטטוס.
- ❌ **לא** להתקין Claude Design / v0 / Superdesign בשלב זה. עלות גבוהה, ערך נמוך למערכת
  פנימית קיימת.

---

## מקורות

**הבעיה והתופעה**
- [The Design Agent for Claude Code: How to Get Real UI, Not Generic AI Slop — Superdesign](https://superdesign.dev/blog/claude-code-ui-design)
- [awesome-claude-design — prompts, skills, honest community takes](https://github.com/rohitg00/awesome-claude-design)
- [Claude Code UI Slop Is Killing Your Front-End Taste](https://productivetechtalk.com/2026/04/16/claude-code-ui-slop-is-killing-your-frontend-taste/)
- [The Design Gap Between Claude Web and Claude Code Is Real — But Fixable](https://baremetaldigest.substack.com/p/the-design-gap-between-claude-web)

**Skills ומקורות אמת עיצוביים**
- [anthropics/claude-code — frontend-design plugin](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design)
- [Frontend Design Plugin — DeepWiki](https://deepwiki.com/anthropics/claude-code/4.6-frontend-design-plugin)
- [google-labs-code/design.md — הספק הרשמי](https://github.com/google-labs-code/design.md)
- [DESIGN.md for shadcn/ui Themes — Shadcnblocks](https://www.shadcnblocks.com/blog/shadcn-theme-design-md)
- [AGENTS.md, SKILL.md, DESIGN.md: How AI Instructions Split into Three Layers](https://dev.to/aws-builders/agentsmd-skillmd-designmd-how-ai-instructions-split-into-three-layers-d0g)
- [frontend-design: consider consuming/producing DESIGN.md — anthropics/skills#1008](https://github.com/anthropics/skills/issues/1008)

**תהליך ולולאה ויזואלית**
- [Giving Claude Code Eyes with Playwright MCP — ap7i.com](https://ap7i.com/posts/giving-claude-code-eyes-with-playwright-mcp/)
- [OneRedOak/claude-code-workflows — design-review](https://github.com/OneRedOak/claude-code-workflows/tree/main/design-review)
- [Level Up Agentic Coding with MCP #2: Stop Describing UI Issues — Luca Becker](https://luca-becker.me/blog/level-up-agentic-coding-mcp-2-playwright/)
- [Turning Claude Code into a Figma-to-React pipeline that visually verifies its own work](https://medium.com/@aliafsah1988/how-to-turn-claude-code-into-a-figma-to-react-pipeline-that-visually-verifies-its-own-work-030246f600a9)

**סטאק וכלים**
- [AI-First UIs: Why shadcn/ui's Model is Leading the Pack — Refine](https://refine.dev/blog/shadcn-blog/)
- [marvkr/better-design — design MCP server + shadcn registry](https://github.com/marvkr/better-design)
- [Claude Design June 2026: Design System Imports, Claude Code Sync, and the Token Burn Fix](https://chatforest.com/builders-log/claude-design-june-2026-design-system-imports-code-sync-token-fix-builder-guide/)

**RTL ועברית**
- [AI Coding Agents Are Great, but They Suck at RTL — Idan Levi](https://dev.to/idanlevi1/ai-coding-agents-are-great-but-they-suck-at-rtl-heres-how-i-fixed-it-2g0g)
- [Tailwind CSS 4.2 Ships New Logical Property Utilities — InfoQ](https://www.infoq.com/news/2026/04/tailwind-css-4-2-webpack/)

**צפיפות מידע וכלים פנימיים**
- [UI Density — Matt Ström-Awn](https://mattstromawn.com/writing/ui-density/)
- [Balancing information density in web development — LogRocket](https://blog.logrocket.com/balancing-information-density-in-web-development/)
- [Designing for information density — UX Collective](https://uxdesign.cc/designing-for-information-density-69775165a18e)
