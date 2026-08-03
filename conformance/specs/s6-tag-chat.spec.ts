import { expect, test } from "@playwright/test";
import { loginAs } from "../fixtures/roles";
import { TAG_SCREEN } from "../fixtures/spec-text";
import {
  createTicket,
  expectExpiredLink,
  openPortalTicket,
  showLink,
  uniq,
  uniqPhone,
} from "../fixtures/world";

/**
 * מסך 6 ו-§5.ה — הצ׳אט הקבוצתי וכללי נראות התגית.
 *
 * זהו הסעיף שבו טעות עולה בדליפת מידע ולא בבאג תצוגה: "הפתיחה חושפת את
 * הצ׳אט הקבוצתי בלבד — ולעולם לא את הפניות שבתגית".
 */

async function tagTicket(page: import("@playwright/test").Page, tagName: string) {
  const contractor = uniq("קבלן-תגית");
  const description = uniq("תקלה-תגית");
  await createTicket(page, {
    building: "בניין א",
    apartment: "1",
    domain: "חשמל",
    description,
    newProfessional: { name: contractor, phone: uniqPhone() },
  });

  await page.getByRole("button", { name: /^הוסף תגית/ }).first().click();
  await page.getByRole("textbox", { name: /חיפוש/ }).fill(tagName);
  await page.getByRole("button", { name: new RegExp(`צור חדש`) }).click();
  await expect(page.getByText(tagName)).toBeVisible();

  const link = await showLink(page, contractor);
  return { contractor, description, link };
}

test.describe("מסך 6 — צ׳אט קבוצתי לפי תגית", () => {
  test("S6-03/S6-04/S6-05 — רשימת הפניות והמונה מוצגים למנהל, ומסומנים כגלויים למנהלים בלבד", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    const tagName = uniq("בדק בית");
    const { description } = await tagTicket(page, tagName);

    await page.goto("/tags");
    await page.getByRole("link", { name: new RegExp(tagName) }).click();

    await expect(page.getByRole("heading", { name: "פניות בתגית" })).toBeVisible();
    await expect(page.getByText("רשימה זו גלויה למנהלים בלבד")).toBeVisible();
    await expect(page.getByText("1 פתוחות · 0 סגורות")).toBeVisible();
    // רשימת הפניות בתגית מציגה מיקום ותחום, לא את התיאור.
    await expect(page.getByRole("link", { name: /בניין א · דירה 1 · חשמל/ })).toBeVisible();
    void description;
  });

  test("S6-06/S6-07/S6-09 — התגית סגורה כברירת מחדל, והפתיחה מציגה את נוסח האפיון", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    const tagName = uniq("תגית-סגורה");
    const { contractor } = await tagTicket(page, tagName);

    await page.goto("/tags");
    await page.getByRole("link", { name: new RegExp(tagName) }).click();

    await expect(page.getByText("התגית סגורה. אף קבלן אינו רואה את הצ׳אט.")).toBeVisible();

    await page.getByRole("button", { name: /^פתח לקבלנים/ }).first().click();
    await page.getByRole("option", { name: new RegExp(`^${contractor}`) }).first().click();
    await page.getByRole("button", { name: "פתח", exact: true }).click();

    await expect(page.getByRole("status")).toContainText(TAG_SCREEN.granted(contractor));
  });

  test("S6-08/PROH-09 — הקבלן רואה בפורטל את הצ׳אט בלבד, ולעולם לא את הפניות שבתגית", async ({
    page,
  }) => {
    await loginAs(page, "managerA");
    const tagName = uniq("תגית-פורטל");
    const { contractor, description, link } = await tagTicket(page, tagName);

    await page.goto("/tags");
    await page.getByRole("link", { name: new RegExp(tagName) }).click();
    const tagUrl = new URL(page.url()).pathname;
    const tagId = tagUrl.split("/").pop() ?? "";

    // לפני הפתיחה — הקישור התקף של הקבלן אינו פותח את צ׳אט התגית.
    await page.goto(`${link}/tag/${tagId}`);
    await expectExpiredLink(page);

    await loginAs(page, "managerA");
    await page.goto(tagUrl);
    await expect(page.getByRole("heading", { name: "מי רואה את הצ׳אט" })).toBeVisible();
    await page.getByRole("button", { name: /^פתח לקבלנים/ }).first().click();
    await page.getByRole("option", { name: new RegExp(`^${contractor}`) }).first().click();
    await page.getByRole("button", { name: "פתח", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(TAG_SCREEN.granted(contractor));

    // אחרי הפתיחה — הצ׳אט נפתח, והפניות אינן מוצגות בשום צורה.
    await page.goto(`${link}/tag/${tagId}`);
    await expect(page.getByText("צ׳אט קבוצתי")).toBeVisible();
    await expect(page.getByText("פניות בתגית")).toHaveCount(0);
    await expect(page.getByText(description)).toHaveCount(0);
    await expect(page.getByText(/פתוחות · .* סגורות/)).toHaveCount(0);
  });

  test("S6-01 — שרשור התגית נפרד משרשור הפנייה", async ({ page }) => {
    await loginAs(page, "managerA");
    const tagName = uniq("תגית-שרשור");
    const { description, link } = await tagTicket(page, tagName);
    const ticketUrl = new URL(page.url()).pathname;

    await page.goto("/tags");
    await page.getByRole("link", { name: new RegExp(tagName) }).click();
    const chatText = uniq("הודעה בצ׳אט התגית");
    await page.getByLabel(/הודעה|תגובה/).first().fill(chatText);
    await page.getByRole("button", { name: "שלח" }).click();
    await expect(page.getByText(chatText)).toBeVisible();

    // ההודעה אינה מופיעה בשרשור הפנייה.
    await page.goto(ticketUrl);
    await expect(page.getByText(chatText)).toHaveCount(0);
    await expect(page.getByText(description)).toBeVisible();

    // ואף לא בפורטל הפנייה של הקבלן.
    await openPortalTicket(page, link, description);
    await expect(page.getByText(chatText)).toHaveCount(0);
  });
});
