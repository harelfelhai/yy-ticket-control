import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { type DraftState, emptyDraftMeta } from "@/lib/draft/fields";
import { he } from "@/lib/he";
import { describeDraftState } from "@/lib/services/draft-display";
import { resetDb } from "../helpers/reset-db";

/**
 * תרגום מזהי הטיוטה לשמות מול בסיס נתונים אמיתי (S8, מסך 7 / 7א).
 *
 * החלק הטהור נבדק ב-`tests/unit/draft-display.test.ts`; כאן נבדק מה שרק
 * הבסיס יכול להוכיח: שכל סוג רשומה נטען מהטבלה הנכונה (דירה לפי `number`
 * ולא `name`), שאתר של סתירה מאתר **אחר** מקבל שם, ושמזהה שנמחק אינו מפיל
 * את המסך אלא מוצג במילים.
 */

let siteId: string;
let otherSiteId: string;
let buildingId: string;
let apartmentId: string;
let domainId: string;
let proId: string;
let userId: string;

beforeEach(async () => {
  await resetDb();
  siteId = (await db.site.create({ data: { name: "גני אלון" } })).id;
  otherSiteId = (await db.site.create({ data: { name: "נווה שקד" } })).id;
  buildingId = (await db.building.create({ data: { siteId, name: "בניין א" } })).id;
  apartmentId = (await db.apartment.create({ data: { buildingId, number: "12" } })).id;
  domainId = (await db.domain.create({ data: { name: "חשמל" } })).id;
  proId = (await db.professional.create({ data: { name: "יוסי חשמל", phone: "0501111111" } })).id;
  userId = (
    await db.user.create({
      data: { role: "SITE_MANAGER", name: "רונית", phone: "0500000009", passwordHash: "x", siteId },
    })
  ).id;
});

function state(): DraftState {
  const meta = emptyDraftMeta();
  meta.SITE = {
    fromEmail: false,
    systemEditedAt: new Date(),
    conflict: true,
    emailValue: { field: "SITE", siteId: otherSiteId },
    emailMessageId: null,
  };
  meta.DOMAIN = {
    fromEmail: false,
    systemEditedAt: new Date(),
    conflict: true,
    emailValue: { field: "DOMAIN", domainId: "domain-that-was-deleted" },
    emailMessageId: null,
  };
  return {
    values: {
      siteId,
      buildingId,
      apartmentId,
      room: null,
      domainId,
      description: "נזילה",
      recipients: [
        { kind: "professional", id: proId, origin: "EMAIL", removedBySystemAt: null },
        { kind: "user", id: userId, origin: "SYSTEM", removedBySystemAt: null },
      ],
    },
    meta,
  };
}

describe("describeDraftState", () => {
  it("טוען שמות מכל הטבלאות — כולל דירה לפי מספרה ואתר של סתירה מאתר אחר", async () => {
    const display = await describeDraftState(state());
    const by = Object.fromEntries(display.fields.map((f) => [f.field, f]));
    expect(by.SITE.systemText).toBe("גני אלון");
    expect(by.SITE.emailText).toBe("נווה שקד");
    expect(by.BUILDING.systemText).toBe("בניין א");
    expect(by.APARTMENT.systemText).toBe("12");
    expect(by.DOMAIN.systemText).toBe("חשמל");
    expect(by.RECIPIENTS.systemText).toBe(`יוסי חשמל${he.emailIntake.listSeparator}רונית`);
    expect(display.conflictCount).toBe(2);
  });

  it("מזהה שאינו קיים עוד מוצג במילים ואינו מפיל את התצוגה", async () => {
    const display = await describeDraftState(state());
    const domain = display.fields.find((f) => f.field === "DOMAIN");
    expect(domain?.emailText).toBe(he.emailDraft.unknownRecord);
  });
});
