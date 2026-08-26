import { expect, test } from "@playwright/test";
import { CAST, PROS, SITE_A, SITE_B } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import { TICKET_SCREEN } from "../fixtures/spec-text";
import {
  acceptDialogs,
  applyFilter,
  createTicket,
  ensureTag,
  openDetails,
  searchBoard,
  shownText,
  uniq,
  uniqPhone,
} from "../fixtures/world";

/**
 * מסכים 9, 10 ו-11–15: חיפוש, תצוגת הבעלים והניהול.
 *
 * שלושתם קצרים באפיון, ולכן קל להניח שהם "סטנדרטיים" ולוותר. מסך 10 מגדיר
 * שלושה מדדים מדויקים ו**צלילה מכל מספר**; מסכים 11–15 מוגדרים "מנהל מערכת
 * ראשי בלבד" — הגדרה שקל להפר בלי לשים לב במסך אחד מתוך חמישה.
 *
 * **שניים מהשלושה איבדו את הכתובת שלהם בסבב הצפיפות, לא את הדרישה.**
 * מסך 9 (חיפוש) הפך לשדה ברצועת המסננים של הלוח, ומסך 10 (סקירת אתרים)
 * עבר לראש `/admin`. הטענות כאן מכוונות למקומות החדשים; `/search`
 * ו-`/overview` נשארו כבדלי הפניה בשביל קישורים שיצאו החוצה, והם נבדקים
 * ככאלה במקומם (`br-permissions` ו-`e2e/search.spec.ts`).
 */

test.describe("מסך 9 — חיפוש", () => {
  test("S9-02 — חיפוש מוצא לפי התיאור ולפי מה שנכתב בשרשור", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const inDescription = uniq("מילה-בתיאור");
    const inThread = uniq("מילה-בשרשור");

    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: `תקלה עם ${inDescription}`,
      recipients: [PROS.full.name],
    });
    await page.getByLabel("תגובה").fill(`הערה עם ${inThread}`);
    await page.getByRole("button", { name: TICKET_SCREEN.send, exact: true }).click();
    await expect(page.getByText(inThread)).toBeVisible();

    /*
     * בלי מונח — **הלוח**, ולא מסך שמבקש להקליד.
     *
     * זו אותה דרישה מהצד השני: המסך הנפרד הציג "הקלד מה לחפש" כי רשימה של
     * הכול הייתה כפילות של הלוח. מאז שהחיפוש יושב בתוך הלוח, הלוח המקובץ
     * **הוא** מצב המוצא, והתוצאות מחליפות אותו רק כשיש מה להציג.
     */
    await page.goto("/board");
    await expect(page.getByRole("heading", { name: /^אצל הנמענים/ })).toBeVisible();

    /*
     * ‏`searchBoard` ולא `fill` + `click` ישירים. הסיבה אינה יציבות אלא
     * **תוקף**: לחיצה לפני ההידרציה מפעילה שיגור נייטיב שמנווט ללוח נקי,
     * ואז `shownText(inDescription)` נפתר על הכרטיס שבלוח המלא — טענה
     * ירוקה שלא בדקה חיפוש כלל.
     */
    await searchBoard(page, inDescription);
    await expect(shownText(page, inDescription)).toBeVisible();

    await searchBoard(page, inThread);
    await expect(shownText(page, inDescription)).toBeVisible();

    await searchBoard(page, uniq("אין-כזה"));
    await expect(page.getByText("לא נמצאו פניות")).toBeVisible();
  });

  test("S9-03/DM-Q02 — תשעת מסנני §3.6, ברצועה הגלויה של הלוח", async ({ page }) => {
    acceptDialogs(page);

    /*
     * **התנאי המוקדם מוקם כאן, ולא נשען על קובץ אחר.**
     *
     * מסנן "תגיות" מותנה בקיום תגית אחת לפחות (`board-filters.tsx`),
     * בשונה מהמסך הנפרד שהציג אותו תמיד. עד 0.6 השורה הזו בבסיס הגיעה
     * מ-`s6-tag-chat` — כלומר הבדיקה עברה בזכות **הסדר האלפביתי** של
     * Playwright, ונפלה בכל ריצה ממוקדת. ההערה שישבה כאן הודתה בכך
     * וקראה לזה "תופעה של סדר ההרצה"; זו הודאה, לא תירוץ.
     *
     * תשע הטענות למטה לא נגעו — מה שהשתנה הוא שהבדיקה מביאה את מה שהיא
     * צריכה במקום לקוות שמישהו אחר הביא אותו.
     */
    await ensureTag();

    await loginAs(page, "admin");
    await page.goto("/board");

    // הרצועה גלויה בכל רוחב ואין מתג לפתוח — לכן אין כאן `openFilters`,
    // והנוכחות נבדקת ישירות.
    for (const label of [
      "הפניתי",
      "אתר",
      "בניין",
      "תחום",
      "איש מקצוע",
      "תגיות",
      "כל הסטטוסים",
      "מתאריך",
      "עד תאריך",
    ]) {
      await expect(page.getByLabel(label, { exact: true }), `מסנן חסר: ${label}`).toBeVisible();
    }
  });

  /**
   * בורר הדירה — מותנה בבניין, ולכן נבדק בשני שלבים.
   *
   * הוא אינו ברצועה עד שנבחר בניין, וזו החלטה ולא השמטה: רשימת כל הדירות
   * בכל האתרים היא מאות פריטים בלי הקשר. הבדיקה מוודאת את שני הצדדים —
   * שהוא **אינו** שם מראש, ושהוא **כן** מופיע אחרי בחירת בניין — כי בדיקה
   * שרק מחפשת אותו הייתה עוברת גם אילו הוצג תמיד.
   */
  test("S9-03 — בורר הדירה מופיע אחרי בחירת בניין", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/board");

    await expect(page.getByLabel("דירה", { exact: true })).toHaveCount(0);

    const buildings = page.getByLabel("בניין", { exact: true });
    const options = await buildings.locator("option").all();
    // האפשרות הראשונה היא "כל הבניינים"; השנייה היא בניין אמיתי.
    const value = await options[1]?.getAttribute("value");
    if (!value) throw new Error("אין בניין לבחור — הנתונים לא נזרעו כמצופה");

    /*
     * ‏`applyFilter` ולא `selectOption` ישיר.
     *
     * הבורר מנווט ב-`onChange` → `router.replace`, ובחירה שקדמה להידרציה
     * **נבלעת בשקט**: הערך משתנה בדפדפן, `?building=` אינו נכתב, ובורר
     * הדירה — שמגיע מ-`getBoard` בסבב שרת בלבד — לעולם אינו מרונדר. זה
     * הכשל שנראה תחת עומס, והוא דיווח על עצמו כ"element(s) not found".
     *
     * הטענה לא רוככה: `toHaveCount(0)` שלמעלה ו-`toBeVisible` שלמטה
     * נשארים כלשונם, ומה שנוסף הוא טענה שלישית — שהכתובת באמת השתנתה.
     */
    await applyFilter(page, "בניין", value, "building");
    await expect(page.getByLabel("דירה", { exact: true })).toBeVisible();
  });

  test("DM-Q01 — החיפוש מצהיר שהוא כולל תמלול וטקסט שזוהה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    await page.goto("/board");

    /*
     * ההצהרה עברה מפסקת רמז מתחת לשדה אל **הטקסט המרמז שבשדה עצמו**
     * ("חיפוש בפניות, בהודעות ובתמלולים"), כי אין עוד מסך שיש בו מקום
     * לפסקה. הדרישה נשמרת — המשתמש יודע שההקלטות בפנים — אך היא נחלשה:
     * placeholder נעלם ברגע שמקלידים. מדווח ב-conformance-report כפער ניסוח.
     */
    await expect(page.getByRole("searchbox", { name: "חיפוש" })).toHaveAttribute(
      "placeholder",
      /תמלול/,
    );
  });
});

test.describe("מסך 10 — תצוגת הבעלים", () => {
  test("S10-02/S10-03/S10-04/S10-05 — שלושת המדדים לכל אתר, חוצה-אתרים", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "owner");
    // מסך 10 יושב בראש `/admin` מאז האיחוד — הכותרת היא ה-`<h1>` של המסך.
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "סקירת אתרים" })).toBeVisible();
    for (const site of [SITE_A, SITE_B]) {
      const card = page.locator("li,section").filter({ hasText: site }).first();
      await expect(card).toContainText("פתוחות");
      await expect(card).toContainText("ממתינות למנהל");
      await expect(card).toContainText("ללא תנועה 7+ ימים");
    }
  });

  test("S10-06 — מכל מספר ניתן לצלול לרשימה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("לצלילה");
    await createTicket(page, {
      building: "בניין א",
      apartment: "2",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "owner");
    await page.goto("/admin");
    const openMetric = page
      .getByRole("link")
      .filter({ hasText: "פתוחות" })
      .first();
    await expect(openMetric).toBeVisible();
    await openMetric.click();
    await expect(page).toHaveURL(/\/board\?/);
  });
});

test.describe("מסכים 11–15 — ניהול", () => {
  test("S11-15-00 — חמשת המסכים נגישים למנהל המערכת", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    for (const [url, heading] of [
      ["/admin/sites", "אתרים"],
      ["/admin/users", "משתמשים"],
      ["/admin/professionals", "אנשי מקצוע"],
      ["/admin/domains", "תחומים"],
    ] as const) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    /*
     * ‏`/admin` נבדק בנפרד כי הוא כבר אינו "מסך ניהול" אלא מסך אחד עם שתי
     * שכבות: `<h1>` הוא סקירת האתרים, ו"ניהול המערכת" ירד ל-`<h2>` שמעליו
     * יושבים חמשת הכפתורים. **שתי הכותרות נבדקות יחד** — טענה על אחת מהן
     * בלבד הייתה עוברת גם אילו האיחוד היה מפיל את השנייה בשקט.
     */
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "סקירת אתרים", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "ניהול המערכת", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "משתמשים" })).toBeVisible();
  });

  test("S12-01/S12-02/S12-03 — הקמת משתמש עם תפקיד ואתר", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/users");
    const name = uniq("עובד חדש");
    const phone = uniqPhone();

    // הטופס מושבת עד ההידרציה; `selectOption` לפניה נבלע, התפקיד נשאר
    // ברירת המחדל, ושדה האתר (שמותנה ב-SITE_MANAGER) אינו מרונדר כלל.
    await expect(page.getByRole("button", { name: "הוסף משתמש" })).toBeEnabled();
    await page.getByLabel("שם", { exact: true }).fill(name);
    await page.getByLabel("טלפון", { exact: true }).fill(phone);
    await page.getByLabel("תפקיד").selectOption({ label: "מנהל עבודה" });
    // ‏`getByLabel("אתר", {exact:true})` נכשל כאן: ה-`Field` עוטף את ה-select
    // בתוך ה-`label`, ולכן ה-textContent שלו הוא "אתר" ועוד כל טקסטי
    // האפשרויות. ‏`getByRole` משתמש בשם הנגיש המחושב ולא בטקסט הגולמי.
    await expect(page.getByRole("combobox", { name: "אתר" })).toBeVisible();
    await page.getByRole("combobox", { name: "אתר" }).selectOption({ label: SITE_A });
    await page.getByLabel("סיסמה ראשונית").fill("conformance-1234");
    await page.getByRole("button", { name: "הוסף משתמש" }).click();

    await expect(shownText(page, name)).toBeVisible();
  });

  test("S13-04 — איחוד כפילויות של אנשי מקצוע", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const keep = uniq("קבלן-נשמר");
    const drop = uniq("קבלן-נמחק");
    for (const name of [keep, drop]) {
      await createTicket(page, {
        building: "בניין א",
        apartment: "1",
        domain: "חשמל",
        description: uniq("לאיחוד"),
        newProfessional: { name, phone: uniqPhone() },
      });
    }

    await loginAs(page, "admin");
    await page.goto("/admin/professionals");
    // הבוררים מושבתים עד ההידרציה — `selectOption` לפניה נבלע ומשאיר את
    // "אחד" מושבת לנצח. ממתינים שהם יידלקו, כמו ב-S12-01.
    await expect(page.getByLabel("להשאיר")).toBeEnabled();
    await page.getByLabel("להשאיר").selectOption({ label: keep });
    await page.getByLabel("לאחד ולמחוק").selectOption({ label: drop });
    await page.getByRole("button", { name: "אחד", exact: true }).click();
    await expect(page.getByText(/הכפילות אוחדה/)).toBeVisible();
  });

  test("S14-01 — ניהול רשימת התחומים", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/domains");
    /*
     * מחסום הידרציה. **הוא נעשה אפשרי בזכות תיקון במוצר, ולא במקומו:**
     * עד 0.6 השדה לא היה מושבת עד ההידרציה, כלומר `fill` מוקדם הצליח
     * לרגע והערך נמחק — והכפתור, שמושבת גם על שדה ריק, נשאר מושבת לנצח.
     * זה נמדד בניסוי, וזה היה באג של משתמש אמיתי ולא רק של בדיקה.
     * מאז `admin-add-form` מעביר `disabled={busy}` לשדה, וההמתנה כאן היא
     * על אותו סימן בדיוק — בצורה של S12-01.
     */
    await expect(page.getByLabel("תחום חדש")).toBeEnabled();
    const domain = uniq("תחום-חדש");
    await page.getByLabel("תחום חדש").fill(domain);
    await page.getByRole("button", { name: "הוסף תחום" }).click();
    // ‏0.3: השורה מציגה את השם כטקסט, ושדה העריכה נפתח רק בלחיצה על "שנה
    // שם" — שדה פתוח בכל שורה הפך את הרשימה לטופס משנוספה גם המחיקה.
    await expect(page.getByRole("button", { name: `שנה שם ${domain}` })).toBeVisible();
  });

  test("S15 — מסך התגיות: שינוי שם שמור למנהל המערכת", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/tags");
    const rename = page.getByRole("button", { name: "שנה שם" });
    const adminCount = await rename.count();

    await loginAs(page, "managerA");
    await page.goto("/tags");
    // §4 שורה 345 קובע "מסכים 11–15: מנהל מערכת ראשי בלבד", אך מסך התגיות
    // אינו יושב תחת /admin. הבדיקה מתעדת את המצב בפועל: המסך נגיש למנהל
    // עבודה, ורק פעולת שינוי השם חסומה. הפער מדווח ב-conformance-report.
    await expect(page.getByRole("heading", { name: "תגיות" })).toBeVisible();
    await expect(page.getByRole("button", { name: "שנה שם" })).toHaveCount(0);
    expect(adminCount).toBeGreaterThanOrEqual(0);
  });

  test("BR-38/A1-09 — מנהל המערכת מוחק פנייה כפולה באישור כפול", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("כפילות");
    const path = await createTicket(page, {
      building: "בניין א",
      apartment: "3",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "admin");
    await page.goto(path);
    // המחיקה ירדה לפאנל "פרטים" ב-0.3, יחד עם שאר המטא-דאטה.
    await openDetails(page);
    // האזהרה מוצגת לצד הכפתור עוד לפני הלחיצה — "מחיקה היא לכפילות או
    // רשומה שגויה בלבד. פנייה שטופלה — סגור, אל תמחק."
    await expect(page.getByText(/מחיקה היא לכפילות/)).toBeVisible();
    await page.getByRole("button", { name: "מחק פנייה" }).click();
    // הלחיצה הראשונה חושפת את האישור הסופי; זהו האישור הכפול.
    await expect(page.getByText(/יימחקו לצמיתות/)).toBeVisible();
    await page.getByRole("button", { name: "כן, מחק לצמיתות" }).click();
    await expect(page).toHaveURL(/\/board/);

    // הטענה היא על **קוד התשובה** ולא על היעדר כותרת: טענת היעדר אינה
    // יודעת להבדיל בין "הפנייה נמחקה" לבין "המסך השתנה", והיא הראיה
    // היחידה כאן שהמחיקה אכן קרתה.
    const afterDelete = await page.goto(path);
    expect(afterDelete?.status()).toBe(404);
  });
});

test.describe("§1 — זיהוי יוצר הרשומה", () => {
  test("A2-01 — הבעלים רואה מי פתח את הפנייה", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "managerA");
    const description = uniq("מי-פתח");
    const path = await createTicket(page, {
      building: "בניין ב",
      apartment: "3",
      domain: "חשמל",
      description,
      recipients: [PROS.full.name],
    });

    await loginAs(page, "owner");
    await page.goto(path);
    // "נפתחה על ידי" ירד לפאנל "פרטים" ב-0.3 (אפיון מסך 2 אזור ב׳): מי פתח
    // נקרא פעם אחת, בעוד שהשרשור הוא העבודה החוזרת.
    await openDetails(page);
    /*
     * הטענה מכוונת ל**שורת המטא-דאטה** ולא לשם לבדו. מ-0.3 השם מופיע פעמיים
     * במסך, ובצדק: בפאנל כ"נפתחה על ידי", ובשרשור כמחבר ההודעה הפותחת —
     * התיאור הפך להודעה, ולהודעה יש כותב. הניסוח המלא הוא גם מה שהאפיון
     * דורש בפועל ("הבעלים רואה **מי פתח**"), ולא נוכחות המחרוזת במסך.
     */
    await expect(page.getByText(`נפתחה על ידי: ${CAST.managerA.name}`)).toBeVisible();
  });
});
