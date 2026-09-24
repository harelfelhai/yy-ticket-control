import { describe, expect, it, vi } from "vitest";
import { type DraftLabels, describeDraftFields, draftLabelIds } from "@/lib/draft/display";
import { DRAFT_FIELDS, type DraftState, emptyDraftMeta } from "@/lib/draft/fields";
import { conflictsVersion, fieldVersion } from "@/lib/draft/state";
import { loadDraftLabels } from "@/lib/services/draft-display";

// `services/draft-display.ts` מייבא את `db`, שדורש DATABASE_URL בזמן הייבוא. כאן
// הלקוח מוזרק (`client`), ולכן מספיק לקוח ריק כדי שהייבוא לא ייכשל.
vi.mock("@/lib/db", () => ({ db: {} }));
import { he } from "@/lib/he";

/**
 * תצוגת מסך 7 / 7א מתוך `DraftState` — טהור, בלי בסיס נתונים (S8).
 *
 * מה שנבדק כאן הוא ההחלטה **מה** מוצג: איזה שדה נושא תג "מהמייל", איזה
 * בסתירה, מה הערך מהמייל שמוצג לצדו, ומה קורה כשמזהה אינו ניתן לתרגום.
 * השירות שטוען את השמות נבדק ב-`tests/integration/draft-display.test.ts`.
 */

function state(): DraftState {
  const meta = emptyDraftMeta();
  meta.DESCRIPTION.fromEmail = true;
  meta.BUILDING = {
    fromEmail: false,
    systemEditedAt: new Date("2026-09-20T10:00:00Z"),
    conflict: true,
    emailValue: { field: "BUILDING", buildingId: "b-gone" },
    emailMessageId: "m2",
  };
  meta.RECIPIENTS = {
    fromEmail: false,
    systemEditedAt: new Date("2026-09-20T10:00:00Z"),
    conflict: true,
    emailValue: {
      field: "RECIPIENTS",
      add: [{ kind: "professional", id: "p2" }],
      remove: [{ kind: "professional", id: "p1" }],
    },
    emailMessageId: "m2",
  };
  return {
    values: {
      siteId: "s1",
      buildingId: "b1",
      apartmentId: "a1",
      room: "KITCHEN",
      domainId: null,
      description: "נזילה מהתקרה",
      recipients: [
        { kind: "professional", id: "p1", origin: "EMAIL", removedBySystemAt: null },
        // מצבה: הוסר במערכת, אינו מוצג כנמען אבל שמו נדרש להצעה להחזירו
        { kind: "user", id: "u9", origin: "SYSTEM", removedBySystemAt: "2026-09-19T08:00:00.000Z" },
      ],
    },
    meta,
  };
}

const LABELS: DraftLabels = {
  site: new Map([["s1", "אתר לדוגמה"]]),
  building: new Map([["b1", "בניין א"]]),
  apartment: new Map([["a1", "12"]]),
  domain: new Map(),
  professional: new Map([
    ["p1", "יוסי החשמלאי"],
    ["p2", "דנה האינסטלטורית"],
  ]),
  user: new Map([["u9", "מנהל שהוסר"]]),
};

describe("draftLabelIds — אילו מזהים צריך לתרגם", () => {
  it("אוסף מזהים מהערכים, מהמצבות ומההצעות שממתינות בסתירה", () => {
    const ids = draftLabelIds(state());
    expect([...ids.site]).toEqual(["s1"]);
    expect([...ids.building].sort()).toEqual(["b-gone", "b1"]);
    expect([...ids.apartment]).toEqual(["a1"]);
    expect([...ids.domain]).toEqual([]);
    expect([...ids.professional].sort()).toEqual(["p1", "p2"]);
    expect([...ids.user]).toEqual(["u9"]);
  });
});

describe("describeDraftFields — מסך 7 ומסך 7א", () => {
  it("מחזיר את כל השדות בסדר DRAFT_FIELDS, עם תווית לכל אחד", () => {
    const display = describeDraftFields(state(), LABELS);
    expect(display.fields.map((f) => f.field)).toEqual([...DRAFT_FIELDS]);
    expect(display.fields.map((f) => f.label)).toEqual([
      he.ticket.site,
      he.directory.building,
      he.directory.apartment,
      he.ticket.room,
      he.directory.domain,
      he.ticket.description,
      he.ticket.recipients,
    ]);
  });

  it("מתרגם מזהים לשמות, ושדה ריק מוצג כ'—' כמו במייל החוזר", () => {
    const by = Object.fromEntries(describeDraftFields(state(), LABELS).fields.map((f) => [f.field, f]));
    expect(by.SITE.systemText).toBe("אתר לדוגמה");
    expect(by.BUILDING.systemText).toBe("בניין א");
    expect(by.APARTMENT.systemText).toBe("12");
    expect(by.ROOM.systemText).toBe(he.room.KITCHEN);
    expect(by.DOMAIN.systemText).toBe(he.emailIntake.empty);
    expect(by.DESCRIPTION.systemText).toBe("נזילה מהתקרה");
    // המצבה אינה נמען: רק יוסי מוצג
    expect(by.RECIPIENTS.systemText).toBe("יוסי החשמלאי");
  });

  it("שדה בסתירה נושא את הערך מהמייל; שדה שאינו בסתירה — לא", () => {
    const display = describeDraftFields(state(), LABELS);
    const by = Object.fromEntries(display.fields.map((f) => [f.field, f]));
    expect(display.conflictCount).toBe(2);
    expect(by.BUILDING.conflict).toBe(true);
    // מזהה שאין לו שם — בניין שנמחק אחרי שהמייל הציע אותו — במילים, לא כמזהה
    expect(by.BUILDING.emailText).toBe(he.emailDraft.unknownRecord);
    expect(by.RECIPIENTS.emailText).toBe(
      `${he.emailDraft.recipientsAdd("דנה האינסטלטורית")}${he.emailIntake.summarySeparator}${he.emailDraft.recipientsRemove("יוסי החשמלאי")}`,
    );
    expect(by.DESCRIPTION.conflict).toBe(false);
    expect(by.DESCRIPTION.emailText).toBeNull();
  });

  it("תג 'מהמייל' וסימון 'חסר' נגזרים מהמטא ומהערכים", () => {
    const by = Object.fromEntries(describeDraftFields(state(), LABELS).fields.map((f) => [f.field, f]));
    expect(by.DESCRIPTION.fromEmail).toBe(true);
    expect(by.BUILDING.fromEmail).toBe(false);
    expect(by.DOMAIN.missing).toBe(true);
    expect(by.ROOM.missing).toBe(false);
    expect(by.RECIPIENTS.missing).toBe(false);
  });

  it("הגרסה היא הטביעה של הסתירות — מה שהחלון מחזיר לשרת", () => {
    const current = state();
    expect(describeDraftFields(current, LABELS).version).toBe(conflictsVersion(current));
  });
});

describe("fieldVersion — טביעת שדה לשמירה במסך 7 (§7 שורה 86)", () => {
  it("כל שדה בתצוגה נושא את הטביעה שלו", () => {
    const current = state();
    for (const field of describeDraftFields(current, LABELS).fields) {
      expect(field.version).toBe(fieldVersion(current, field.field));
    }
  });

  it("משתנה כשהערך משתנה, כשנפתחת סתירה וכשהערך מהמייל מתחלף — ולא בשדה אחר", () => {
    const before = state();
    const domainBefore = fieldVersion(before, "DOMAIN");

    const filled = state();
    filled.values.domainId = "d1";
    expect(fieldVersion(filled, "DOMAIN")).not.toBe(domainBefore);

    const conflicted = state();
    conflicted.meta.DOMAIN = {
      fromEmail: false,
      systemEditedAt: new Date(),
      conflict: true,
      emailValue: { field: "DOMAIN", domainId: "d2" },
      emailMessageId: "m3",
    };
    expect(fieldVersion(conflicted, "DOMAIN")).not.toBe(domainBefore);

    const replaced = state();
    replaced.meta.BUILDING = { ...replaced.meta.BUILDING, emailValue: { field: "BUILDING", buildingId: "b9" } };
    expect(fieldVersion(replaced, "BUILDING")).not.toBe(fieldVersion(before, "BUILDING"));

    // שינוי בשדה אחד אינו נוגע בטביעה של אחר
    expect(fieldVersion(filled, "BUILDING")).toBe(fieldVersion(before, "BUILDING"));
  });

  it("נמען שהמייל הוסיף משנה את טביעת הנמענים", () => {
    const before = state();
    const added = state();
    added.values.recipients.push({ kind: "professional", id: "p7", origin: "EMAIL", removedBySystemAt: null });
    expect(fieldVersion(added, "RECIPIENTS")).not.toBe(fieldVersion(before, "RECIPIENTS"));
  });
});

describe("loadDraftLabels — שאילתה רק לסוגים שיש בהם מזהים", () => {
  it("אינו שואל על טבלאות שאין להן מזהים, ושואל פעם אחת לכל סוג שיש", async () => {
    const rows = (list: { id: string; name: string }[] = []) => vi.fn(async () => list);
    const client = {
      site: { findMany: rows([{ id: "s1", name: "אתר" }]) },
      building: { findMany: rows() },
      apartment: { findMany: vi.fn(async () => [] as { id: string; number: string }[]) },
      domain: { findMany: rows() },
      professional: { findMany: rows() },
      user: { findMany: rows() },
    };
    const only = state();
    only.values = { ...only.values, buildingId: null, apartmentId: null, recipients: [] };
    only.meta = emptyDraftMeta();

    const labels = await loadDraftLabels(only, client as never);

    expect(labels.site.get("s1")).toBe("אתר");
    expect(client.site.findMany).toHaveBeenCalledTimes(1);
    for (const table of [client.building, client.apartment, client.domain, client.professional, client.user]) {
      expect(table.findMany).not.toHaveBeenCalled();
    }
  });
});
