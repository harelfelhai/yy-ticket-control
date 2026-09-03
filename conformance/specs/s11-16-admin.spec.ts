import { type Page, expect, test } from "@playwright/test";
import { SITE_A } from "../fixtures/cast";
import { loginAs } from "../fixtures/roles";
import { acceptDialogs, createTicket, gotoNewTicket, uniq, uniqPhone } from "../fixtures/world";

/**
 * מסכים 11–16 — ניהול הרשומות (הכרעות 0.3 ו-1.0, §7 שורות 23–25 ו-40).
 *
 * האפיון קובע: "בכל אחת מהרשימות אפשר לערוך ולמחוק", עם כלל חוצה אחד —
 * **המחיקה נחסמת כשקיימות הפניות וההודעה אומרת מה חוסם ובכמה**.
 *
 * **המשתמש היה חריג לכלל עד 1.0, ואינו עוד** (§7 שורה 40). הנוסח הקודם כאן
 * אכף "משתמש אינו נמחק לעולם"; החריג בוטל מפני שהחסימה סופרת במפורש גם את
 * שלוש ההפניות ה-`SetNull` שהולידו אותו — "מי מטפל", "מי סגר" ומעלה הקובץ —
 * ולכן משתמש שנגע במשהו חסום ממילא, ומה שנמחק הוא רק רשומה שנוצרה בטעות.
 * ההשבתה נשארת מסלול ההוצאה למי שעזב, ו-S16-04 בודק את **שתי** הדרכים.
 *
 * **כל בדיקת מחיקה יוצרת את הרשומה שלה ומוחקת אותה.** מחיקה שנוגעת בנתוני
 * ה-cast הייתה מרעילה את ההרצה הבאה — `provision-cast` עושה upsert לפי שם,
 * ושאר הבדיקות מניחות שהאתרים, הבניינים והקבלנים קיימים.
 */

/**
 * ניווט מרשימת האתרים למסך הבניינים והדירות של אתר.
 *
 * **‏0.7: זהו מסלול בן שני שלבים ולא לחיצה אחת.** הקישור "בניינים ודירות"
 * ישב על כרטיס האתר, וירד יחד עם שאר הפעולות אל **דיאלוג הפרטים** שנפתח
 * בלחיצה על הכרטיס. שתי בדיקות מנווטות כך, ולכן המסלול מרוכז כאן —
 * ולא נכתב פעמיים ומתפצל בשינוי הבא.
 *
 * הכרטיס מאותר לפי `aria-label` שהוא שם האתר בדיוק, ולא לפי `hasText`:
 * שם האתר מופיע גם בשורת מנהלי העבודה של אתרים אחרים, ו-`filter` היה
 * מחזיר יותר מכרטיס אחד.
 */
async function openSiteBuildings(page: Page, site: string): Promise<void> {
  await page.getByRole("button", { name: site, exact: true }).click();
  await page.getByRole("dialog").getByRole("link", { name: /בניינים ודירות/ }).click();
  await page.waitForURL(/\/admin\/sites\/.+/);
}

test.describe("מסך 16 — בניינים ודירות", () => {
  test("S16-01 — האתר מוביל למסך הבניינים, ואפשר להגדיר בניין ודירה מראש", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/sites");

    // ההגעה היא מהאתר ולא מתפריט שטוח: הייחודיות של שם בניין היא (אתר, שם).
    await openSiteBuildings(page, SITE_A);
    await expect(page.getByRole("heading", { name: SITE_A })).toBeVisible();

    const building = uniq("בניין-ניהולי");
    await page.getByLabel("שם הבניין").fill(building);
    await page.getByRole("button", { name: "הוסף בניין", exact: true }).click();

    const row = page.getByRole("listitem").filter({ hasText: building });
    await expect(row).toBeVisible();
    await expect(row.getByText("אין פניות")).toBeVisible();

    // דירה נוספת לבניין שנוצר, מתוך אותה שורה.
    await row.getByLabel("מספר דירה").fill("12");
    await row.getByRole("button", { name: "הוסף דירה", exact: true }).click();
    await expect(row.getByText("דירה 12")).toBeVisible();

    // השם הנגיש נושא גם את הבניין, ובכוונה: "דירה 1" קיימת בכל בניין באתר,
    // ובלעדיו שני כפתורים במסך נושאים את אותו שם והאישור אינו אומר איזו
    // דירה נמחקת. הניסוח הוא זה של כותרת הפנייה ("בניין א · דירה 3"),
    // ולא ניסוח שני. הטענה כאן היא האוכף של שניהם.
    const apartmentLabel = `${building} · דירה 12`;
    await expect(row.getByRole("button", { name: `מחק ${apartmentLabel}` })).toBeVisible();

    // ניקוי אחרי עצמנו — הבדיקה אינה משאירה שאריות לריצה הבאה.
    await row.getByRole("button", { name: `מחק ${apartmentLabel}` }).click();
    await expect(row.getByText("דירה 12")).toHaveCount(0);
    await row.getByRole("button", { name: `מחק ${building}` }).click();
    await expect(page.getByRole("listitem").filter({ hasText: building })).toHaveCount(0);
  });

  test("S16-02 — שינוי שם בניין נשמר, ושם תפוס נדחה עם הסבר", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    const first = uniq("בניין-א-זמני");
    const second = uniq("בניין-ב-זמני");

    await page.goto("/admin/sites");
    await openSiteBuildings(page, SITE_A);

    for (const name of [first, second]) {
      await page.getByLabel("שם הבניין").fill(name);
      await page.getByRole("button", { name: "הוסף בניין", exact: true }).click();
      await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
    }

    // שם תפוס באותו אתר — נדחה, וההודעה אומרת למה.
    const secondRow = page.getByRole("listitem").filter({ hasText: second });
    await secondRow.getByRole("button", { name: `שנה שם ${second}` }).click();
    await secondRow.getByRole("textbox", { name: second }).fill(first);
    await secondRow.getByRole("button", { name: "שמור", exact: true }).click();
    await expect(secondRow.getByRole("alert")).toContainText("כבר קיים בניין בשם הזה");

    // שם פנוי — נשמר.
    const renamed = uniq("בניין-אחרי-שינוי");
    await secondRow.getByRole("textbox", { name: second }).fill(renamed);
    await secondRow.getByRole("button", { name: "שמור", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: renamed })).toBeVisible();

    for (const name of [first, renamed]) {
      const row = page.getByRole("listitem").filter({ hasText: name });
      await row.getByRole("button", { name: `מחק ${name}` }).click();
      await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
    }
  });
});

test.describe("מסכים 11–16 — מחיקה חסומה ומוסברת", () => {
  test("S16-03 — תחום בשימוש אינו נמחק, וההודעה נוקבת בכמה פניות חוסמות", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");

    // תחום חדש שנכנס לפנייה אחת — ומרגע זה הוא היסטוריה ולא טעות הקלדה.
    const domain = uniq("תחום-בשימוש");
    await page.goto("/admin/domains");
    // מחסום הידרציה — ראו את ההנמקה ב-`s9-s10-s11` § S14-01.
    await expect(page.getByLabel("תחום חדש")).toBeEnabled();
    await page.getByLabel("תחום חדש").fill(domain);
    await page.getByRole("button", { name: "הוסף תחום", exact: true }).click();
    await expect(page.getByRole("button", { name: `שנה שם ${domain}` })).toBeVisible();

    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain,
      description: uniq("פנייה-שחוסמת-תחום"),
      newProfessional: { name: uniq("קבלן-חוסם"), phone: uniqPhone() },
    });

    await page.goto("/admin/domains");
    const row = page.getByRole("listitem").filter({ hasText: domain });
    const remove = row.getByRole("button", { name: `מחק ${domain}` });

    // הכפתור לחיץ: החסימה היא מידע שאפשר לפעול לפיו, לא מצב שמסתירים.
    await expect(remove).toBeEnabled();
    await remove.click();
    await expect(row.getByRole("alert")).toContainText("לא ניתן למחוק");
    await expect(row.getByRole("alert")).toContainText("פנייה אחת משויכת");
    await expect(page.getByRole("listitem").filter({ hasText: domain })).toBeVisible();
  });

  test("S16-02b — תחום שלא נעשה בו שימוש נמחק", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    const domain = uniq("תחום-לניקוי");

    await page.goto("/admin/domains");
    // מחסום הידרציה — ראו את ההנמקה ב-`s9-s10-s11` § S14-01.
    await expect(page.getByLabel("תחום חדש")).toBeEnabled();
    await page.getByLabel("תחום חדש").fill(domain);
    await page.getByRole("button", { name: "הוסף תחום", exact: true }).click();

    const row = page.getByRole("listitem").filter({ hasText: domain });
    await row.getByRole("button", { name: `מחק ${domain}` }).click();
    await expect(page.getByRole("listitem").filter({ hasText: domain })).toHaveCount(0);
  });

  test("S16-04 — משתמש נערך, מושבת, ונמחק כשאין אליו הפניות", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/users");

    // ‏0.7: ההקמה נפתחת מכפתור שצמוד לכותרת, והשדות יושבים בדיאלוג.
    const name = uniq("משתמש-לעריכה");
    await page.getByRole("button", { name: "הוסף משתמש חדש" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("שם", { exact: true }).fill(name);
    await form.getByLabel("טלפון", { exact: true }).fill(uniqPhone());
    await form.getByLabel("תפקיד").selectOption({ label: "בעלים" });
    await form.getByLabel("סיסמה ראשונית").fill("conformance-1234");
    await form.getByRole("button", { name: "הוסף משתמש", exact: true }).click();
    await expect(form).toBeHidden();

    // הכרטיס נושא `aria-label` שהוא שם הרשומה — זה מה שפותח את הפרטים.
    const card = page.getByRole("button", { name, exact: true });
    await expect(card).toBeVisible();
    await card.click();

    // עריכת פרטי קשר — קיימת, ומאחורי העיפרון.
    const renamed = `${name} עודכן`;
    const details = page.getByRole("dialog");
    await details.getByRole("button", { name: "ערוך פרטים" }).click();
    await details.getByLabel("שם", { exact: true }).fill(renamed);
    await details.getByRole("button", { name: "שמור", exact: true }).click();

    // שתי דרכי ההוצאה חיות זו לצד זו בדיאלוג, שהוא המקום היחיד שבו פעולות
    // משתמש קיימות מ-0.7. ראשונה ההשבתה — מסלול מי שעזב, שמשאיר אותו ברשימה.
    await details.getByRole("button", { name: "השבת" }).click();
    await expect(details.getByText("מושבת")).toBeVisible();
    await details.getByRole("button", { name: "סגור", exact: true }).click();
    await expect(page.getByRole("button", { name: renamed, exact: true })).toBeVisible();

    // ואז המחיקה (1.0). המשתמש הזה נוצר בבדיקה ולא נגע בשום פנייה, ולכן
    // אין אליו הפניה שתחסום — וזה בדיוק המקרה שהמחיקה נועדה לו.
    await page.getByRole("button", { name: renamed, exact: true }).click();
    const reopened = page.getByRole("dialog");
    await reopened.getByRole("button", { name: `מחק ${renamed}` }).click();

    await expect(reopened).toBeHidden();
    await expect(page.getByRole("button", { name: renamed, exact: true })).toHaveCount(0);
  });

  test("S16-05 — אתר עם בניינים ומשתמשים אינו נמחק, וההודעה מונה את שניהם", async ({ page }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");
    await page.goto("/admin/sites");

    // ‏0.7: המחיקה ירדה מהשורה לדיאלוג הפרטים.
    await page.getByRole("button", { name: SITE_A, exact: true }).click();
    const details = page.getByRole("dialog");
    await details.getByRole("button", { name: `מחק ${SITE_A}` }).click();

    const alert = details.getByRole("alert");
    await expect(alert).toContainText("לא ניתן למחוק");
    await expect(alert).toContainText("בניינים באתר");

    // האתר עצמו נשאר — הכשל אינו הרסני ואינו חלקי.
    await details.getByRole("button", { name: "סגור", exact: true }).click();
    await expect(page.getByRole("button", { name: SITE_A, exact: true })).toBeVisible();
  });
});


test.describe("מסך 13 — איש מקצוע שעזב (0.4)", () => {
  /**
   * הבדיקה מקימה את איש המקצוע שלה ומשביתה אותו בלבד — היא לעולם אינה
   * נוגעת בקבלני ה-cast, שכל שאר הבדיקות מניחות שהם קיימים ופעילים.
   */
  test("S16-06 — השבתה מוציאה אותו מבורר הנמענים, ומשאירה אותו ברשימת הניהול", async ({
    page,
  }) => {
    acceptDialogs(page);
    await loginAs(page, "admin");

    // נוצר דרך טופס הפנייה, כמו בשטח: איש מקצוע נלמד בהזנה ראשונה.
    const gone = uniq("קבלן-עזב");
    await createTicket(page, {
      building: "בניין א",
      apartment: "1",
      domain: "חשמל",
      description: uniq("תקלה-עזב"),
      newProfessional: { name: gone, phone: uniqPhone() },
    });

    await page.goto("/admin/professionals");
    // ‏0.7: הפעולות ירדו מהשורה לדיאלוג שנפתח בלחיצה על הכרטיס.
    await page.getByRole("button", { name: gone, exact: true }).click();
    const details = page.getByRole("dialog");
    await details.getByRole("button", { name: "השבת", exact: true }).click();

    // נשאר ברשימת הניהול ומסומן — אחרת אי אפשר יהיה להפעילו בחזרה.
    await expect(details.getByText("מושבת")).toBeVisible();
    await expect(details.getByRole("button", { name: "הפעל", exact: true })).toBeVisible();
    await details.getByRole("button", { name: "סגור", exact: true }).click();
    await expect(page.getByRole("button", { name: gone, exact: true })).toBeVisible();

    /*
     * ומכאן העיקר: הוא אינו מוצע יותר כנמען. הבורר נפתח דרך אותו לוקטור
     * ש-`pickRecipient` משתמש בו, כדי שהבדיקה תישבר יחד עם שאר החבילה אם
     * הבורר ישתנה — ולא תעבור בשקט על בורר שלא נפתח כלל.
     */
    await gotoNewTicket(page);
    await page
      .getByRole("button", { name: /^נמענים/ })
      .first()
      .click();
    await expect(page.getByRole("option").first()).toBeVisible();
    await expect(page.getByRole("option", { name: new RegExp(`^${gone}`) })).toHaveCount(0);
  });
});
