import { describe, expect, it } from "vitest";
import { emptyDraftMeta, emptyMeta } from "@/lib/draft/fields";
import { applySystemEdit, mergeChannelIntoDraft } from "@/lib/draft/merge";
import {
  type DraftFieldRow,
  type DraftTicketRow,
  conflictsVersion,
  diffDraftState,
  emailDraftCounts,
  parseChannelValue,
  toDraftState,
} from "@/lib/draft/state";

/**
 * המעבר בין המסד ל-`DraftState` (S4). מנוע המיזוג עצמו נבדק ב-`draft-merge.test.ts`;
 * כאן נבדק שמה שנקרא מהמסד ומה שנכתב אליו משקפים את המנוע במדויק.
 */

const T0 = new Date("2026-09-17T09:00:00Z");
const T1 = new Date("2026-09-17T10:00:00Z");
const T2 = new Date("2026-09-17T11:00:00Z");

function ticket(overrides: Partial<DraftTicketRow> = {}): DraftTicketRow {
  return {
    siteId: "site-a",
    buildingId: "b-1",
    apartmentId: "apt-1",
    room: null,
    domainId: null,
    description: "נזילה",
    draftRecipients: [{ kind: "professional", id: "p-1" }],
    ...overrides,
  };
}

function row(overrides: Partial<DraftFieldRow> & Pick<DraftFieldRow, "field">): DraftFieldRow {
  return { fromChannel: false, systemEditedAt: null, conflict: false, channelValue: null, emailMessageId: null, ...overrides };
}

describe("toDraftState", () => {
  it("EM-M03 — ערכים מהפנייה, מטא מהשורות, ושדה בלי שורה מקבל מטא ריק", () => {
    const state = toDraftState(ticket(), [
      row({ field: "BUILDING", fromChannel: true }),
      row({ field: "DOMAIN", conflict: true, systemEditedAt: T0, channelValue: { field: "DOMAIN", domainId: "d-2" }, emailMessageId: "m-1" }),
    ]);

    expect(state.values).toMatchObject({ siteId: "site-a", buildingId: "b-1", description: "נזילה" });
    expect(state.meta.BUILDING.fromChannel).toBe(true);
    expect(state.meta.DOMAIN).toEqual({
      fromChannel: false,
      systemEditedAt: T0,
      conflict: true,
      channelValue: { field: "DOMAIN", domainId: "d-2" },
      channelMessageId: "m-1",
    });
    expect(state.meta.APARTMENT).toEqual(emptyMeta());
  });

  it("EM-C08 — נמענים שנשמרו לפני 1.3 נקראים כמקור מערכת", () => {
    const state = toDraftState(ticket(), []);
    expect(state.values.recipients).toEqual([{ kind: "professional", id: "p-1", origin: "SYSTEM", removedBySystemAt: null }]);
  });

  it("EM-C08 — נמען שנשמר לפני 1.4 עם המקור EMAIL נקרא כנמען מהערוץ", () => {
    const state = toDraftState(ticket({ draftRecipients: [{ kind: "professional", id: "p-1", origin: "EMAIL" }] }), []);
    expect(state.values.recipients).toEqual([{ kind: "professional", id: "p-1", origin: "CHANNEL", removedBySystemAt: null }]);
  });
});

describe("parseChannelValue", () => {
  it("EM-C06 — ערך תקין לכל שדה נקרא כמות שהוא", () => {
    expect(parseChannelValue("SITE", { field: "SITE", siteId: "s" })).toEqual({ field: "SITE", siteId: "s" });
    expect(parseChannelValue("ROOM", { field: "ROOM", room: "KITCHEN" })).toEqual({ field: "ROOM", room: "KITCHEN" });
    expect(parseChannelValue("DESCRIPTION", { field: "DESCRIPTION", text: "חדש" })).toEqual({ field: "DESCRIPTION", text: "חדש" });
    expect(
      parseChannelValue("RECIPIENTS", { field: "RECIPIENTS", add: [{ kind: "user", id: "u" }, { kind: "x", id: "bad" }], remove: null }),
    ).toEqual({ field: "RECIPIENTS", add: [{ kind: "user", id: "u" }], remove: [] });
  });

  it.each([
    ["null", null],
    ["מחרוזת", "site"],
    ["שדה אחר", { field: "BUILDING", buildingId: "b" }],
    ["מזהה ריק", { field: "SITE", siteId: "" }],
    ["מזהה שאינו מחרוזת", { field: "SITE", siteId: 7 }],
  ])("EM-C06 — ערך פגום (%s) נקרא כ-null ולא מפיל את הטיוטה", (_name, raw) => {
    expect(parseChannelValue("SITE", raw)).toBeNull();
  });
});

describe("diffDraftState", () => {
  it("EM-C05 — עריכה במערכת כותבת רק את מה שהשתנה, ומטא רק בטיוטה ממייל", () => {
    const before = toDraftState(ticket(), [row({ field: "DOMAIN", fromChannel: true })]);
    const after = applySystemEdit(before, { field: "DOMAIN", domainId: "d-9" }, T1);

    const email = diffDraftState(before, after, true);
    expect(email.ticket).toEqual({ domainId: "d-9" });
    expect(email.changedValues).toEqual(["DOMAIN"]);
    expect(email.fields).toEqual([{ field: "DOMAIN", meta: { ...emptyMeta(), systemEditedAt: T1 } }]);

    const manual = diffDraftState(before, after, false);
    expect(manual.ticket).toEqual({ domainId: "d-9" });
    expect(manual.fields).toEqual([]);
  });

  it("EM-C09 — שמירה מפורשת בלי שינוי ערך: אין כתיבה לפנייה ואין אירוע, אבל תג 'מהמייל' יורד", () => {
    const before = toDraftState(ticket({ domainId: "d-1" }), [row({ field: "DOMAIN", fromChannel: true })]);
    const after = applySystemEdit(before, { field: "DOMAIN", domainId: "d-1" }, T1);

    const write = diffDraftState(before, after, true);
    expect(write.ticket).toEqual({});
    expect(write.changedValues).toEqual([]);
    expect(write.fields.map((f) => [f.field, f.meta.fromChannel, f.meta.systemEditedAt])).toEqual([["DOMAIN", false, T1]]);
  });

  it("EM-C10 — החלפת אתר מאפסת בניין ודירה, והנמענים נשארים", () => {
    const before = toDraftState(ticket(), []);
    const after = applySystemEdit(before, { field: "SITE", siteId: "site-b" }, T1);

    const write = diffDraftState(before, after, false);
    expect(write.ticket).toEqual({ siteId: "site-b", buildingId: null, apartmentId: null });
    expect(write.changedValues).toEqual(["SITE", "BUILDING", "APARTMENT"]);
  });

  it("EM-C08 — נמען שהוסר: בטיוטה ממייל נשמרת מצבה, בטיוטה ידנית הוא פשוט יורד", () => {
    const before = toDraftState(ticket({ draftRecipients: [{ kind: "professional", id: "p-1" }, { kind: "user", id: "u-1" }] }), []);
    const after = applySystemEdit(before, { field: "RECIPIENTS", recipients: [{ kind: "user", id: "u-1" }] }, T1);

    expect(diffDraftState(before, after, true).ticket.draftRecipients).toEqual([
      { kind: "user", id: "u-1", origin: "SYSTEM", removedBySystemAt: null },
      { kind: "professional", id: "p-1", origin: "SYSTEM", removedBySystemAt: T1.toISOString() },
    ]);
    expect(diffDraftState(before, after, false).ticket.draftRecipients).toEqual([
      { kind: "user", id: "u-1", origin: "SYSTEM", removedBySystemAt: null },
    ]);
    expect(diffDraftState(before, after, false).changedValues).toEqual(["RECIPIENTS"]);
  });

  it("נמענים שנשמרו בצורה הישנה ולא נערכו — אינם נכתבים מחדש", () => {
    const state = toDraftState(ticket(), []);
    const after = applySystemEdit(state, { field: "ROOM", room: "KITCHEN" }, T1);
    expect(diffDraftState(state, after, false).ticket).toEqual({ room: "KITCHEN" });
  });
});

describe("conflictsVersion", () => {
  function conflicted() {
    const edited = applySystemEdit(toDraftState(ticket({ domainId: "d-1" }), []), { field: "DOMAIN", domainId: "d-1" }, T0);
    return mergeChannelIntoDraft({ state: edited, proposal: { domain: "d-2" }, receivedAt: T1, messageId: "m-1" }).state;
  }

  it("EM-C06 — משתנה כשתשובה חדשה מחליפה את הערך הממתין", () => {
    const first = conflicted();
    expect(first.meta.DOMAIN.conflict).toBe(true);
    const second = mergeChannelIntoDraft({ state: first, proposal: { domain: "d-3" }, receivedAt: T2, messageId: "m-2" }).state;

    expect(conflictsVersion(second)).not.toBe(conflictsVersion(first));
  });

  it("EM-C05 — משתנה כשהשדה שבסתירה נערך במערכת (והסתירה נסגרת)", () => {
    const first = conflicted();
    const edited = applySystemEdit(first, { field: "DOMAIN", domainId: "d-4" }, T2);
    expect(conflictsVersion(edited)).not.toBe(conflictsVersion(first));
  });

  it("אינו משתנה מעריכה של שדה שאינו בסתירה — ההכרעה בחלון עדיין תקפה", () => {
    const first = conflicted();
    const edited = applySystemEdit(first, { field: "ROOM", room: "KITCHEN" }, T2);
    expect(conflictsVersion(edited)).toBe(conflictsVersion(first));
  });

  it("טיוטה בלי סתירות — גרסה יציבה וריקה", () => {
    expect(conflictsVersion({ values: toDraftState(ticket(), []).values, meta: emptyDraftMeta() })).toBe("[]");
  });
});

describe("emailDraftCounts", () => {
  it("EM-S1-02 — סופר שדות חובה חסרים (חדר אינו חובה) ומעביר את מספר הסתירות", () => {
    const values = toDraftState(ticket({ siteId: null, buildingId: null, apartmentId: null, draftRecipients: [] }), []).values;
    // אתר, בניין, דירה, תחום, נמענים
    expect(emailDraftCounts(values, 2)).toEqual({ conflictCount: 2, missingCount: 5 });
  });
});
