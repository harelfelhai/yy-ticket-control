import { describe, expect, it } from "vitest";
import {
  type DraftFieldName,
  type DraftRecipient,
  type DraftState,
  type DraftValues,
  type FieldMeta,
  type RecipientRef,
  conflictFields,
  emptyDraftMeta,
  emptyDraftValues,
} from "@/lib/draft/fields";
import {
  type EmailProposal,
  type MergeResult,
  type ScalarDecision,
  applySystemEdit,
  decideScalar,
  mergeEmailIntoDraft,
  resolveChoices,
} from "@/lib/draft/merge";

/**
 * מנוע המיזוג — §5.ה4 (תשובה במייל מול עריכה במערכת) ו-§3.5 ("סתירה פתוחה").
 *
 * כל שורה בטבלת §5.ה4 היא בדיקה אחת בקובץ, בשם שנושא את מזהה הדרישה.
 * כל קלט עובר הקפאה עמוקה לפני הקריאה למנוע, כך שכל בדיקה בקובץ מאמתת גם
 * שהמנוע אינו משנה את הטיוטה שקיבל.
 */

// ──────────────────────────────── עזרים ────────────────────────────────

const BASE = new Date("2026-09-01T08:00:00Z");

/** נקודת זמן יחסית, בדקות — כדי שסדר האירועים בבדיקה ייקרא במבט */
function at(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

interface DraftOverrides {
  values?: Partial<DraftValues>;
  meta?: Partial<Record<DraftFieldName, Partial<FieldMeta>>>;
}

function draft(overrides: DraftOverrides = {}): DraftState {
  const meta = emptyDraftMeta();
  for (const [field, patch] of Object.entries(overrides.meta ?? {})) {
    meta[field as DraftFieldName] = { ...meta[field as DraftFieldName], ...patch };
  }
  return { values: { ...emptyDraftValues(), ...overrides.values }, meta };
}

function merge(state: DraftState, proposal: EmailProposal, receivedAt: Date, messageId = "msg-1"): MergeResult {
  return mergeEmailIntoDraft({ state: deepFreeze(state), proposal: deepFreeze(proposal), receivedAt, messageId });
}

const pro = (id: string): RecipientRef => ({ kind: "professional", id });
const user = (id: string): RecipientRef => ({ kind: "user", id });

function recipient(ref: RecipientRef, origin: DraftRecipient["origin"], removedBySystemAt: Date | null = null): DraftRecipient {
  return { ...ref, origin, removedBySystemAt: removedBySystemAt ? removedBySystemAt.toISOString() : null };
}

/** טיוטה שבה הדירה נקבעה במערכת בדקה 10 */
function apartmentEditedInSystem(apartmentId = "apt-12"): DraftState {
  return draft({
    values: { siteId: "site-1", buildingId: "bld-a", apartmentId },
    meta: { APARTMENT: { systemEditedAt: at(10) } },
  });
}

// ───────────────────────────── decideScalar ─────────────────────────────

describe("decideScalar — ההכרעה לשדה סקלרי אחד", () => {
  const cases: {
    name: string;
    meta: Partial<FieldMeta>;
    current: unknown;
    proposed: unknown;
    expected: ScalarDecision;
  }[] = [
    { name: "לא נערך במערכת, ערך שונה", meta: {}, current: "a", proposed: "b", expected: "apply" },
    { name: "שדה ריק שלא נערך", meta: {}, current: null, proposed: "b", expected: "apply" },
    { name: "ערך קודם מהמייל", meta: { fromEmail: true }, current: "a", proposed: "b", expected: "apply" },
    { name: "זהה, בלי סתירה", meta: {}, current: "a", proposed: "a", expected: "noop" },
    { name: "זהה לערך במערכת, בלי סתירה", meta: { systemEditedAt: at(10) }, current: "a", proposed: "a", expected: "noop" },
    {
      name: "זהה לערך במערכת כשיש סתירה",
      meta: { systemEditedAt: at(10), conflict: true },
      current: "a",
      proposed: "a",
      expected: "close",
    },
    { name: "נערך במערכת לפני המייל, ערך שונה", meta: { systemEditedAt: at(10) }, current: "a", proposed: "b", expected: "conflict" },
    { name: "נערך במערכת בדיוק בזמן המייל", meta: { systemEditedAt: at(30) }, current: "a", proposed: "b", expected: "conflict" },
    { name: "נערך במערכת אחרי המייל", meta: { systemEditedAt: at(31) }, current: "a", proposed: "b", expected: "ignore" },
    {
      name: "נערך במערכת אחרי המייל — גם כשהערך זהה",
      meta: { systemEditedAt: at(31), conflict: true },
      current: "a",
      proposed: "a",
      expected: "ignore",
    },
  ];

  it.each(cases)("EM-C03/C04/C05 — $name ⇒ $expected", ({ meta, current, proposed, expected }) => {
    const full: FieldMeta = { ...emptyDraftMeta().SITE, ...meta };
    expect(decideScalar(full, current, proposed, at(30))).toBe(expected);
  });
});

// ─────────────────────── טבלת §5.ה4, שורה אחר שורה ───────────────────────

describe("§5.ה4 — תשובה במייל מול עריכה במערכת", () => {
  it("EM-C03 — שורה 1: שדה שלא נערך במערכת (ריק) מקבל את הערך מהמייל בשקט, עם תג \"מהמייל\"", () => {
    const result = merge(draft({ values: { siteId: "site-1" } }), { building: "bld-a", room: "KITCHEN" }, at(30));

    expect(result.state.values.buildingId).toBe("bld-a");
    expect(result.state.values.room).toBe("KITCHEN");
    expect(result.state.meta.BUILDING).toMatchObject({ fromEmail: true, conflict: false, systemEditedAt: null });
    expect(result.changes).toEqual([
      { field: "BUILDING", before: null, after: "bld-a", cause: "email" },
      { field: "ROOM", before: null, after: "KITCHEN", cause: "email" },
    ]);
    expect(result.conflictsOpened).toEqual([]);
    expect(result.ignored).toEqual([]);
  });

  it("EM-C03 — שורה 1: ערך שחולץ ממייל קודם מוחלף בשקט בערך מהתשובה", () => {
    const state = draft({ values: { room: "KITCHEN" }, meta: { ROOM: { fromEmail: true } } });
    const result = merge(state, { room: "BATHROOM" }, at(30));

    expect(result.state.values.room).toBe("BATHROOM");
    expect(result.state.meta.ROOM.conflict).toBe(false);
    expect(result.changes).toEqual([{ field: "ROOM", before: "KITCHEN", after: "BATHROOM", cause: "email" }]);
  });

  it("EM-C04 — שורה 2: ערך שונה לשדה שנערך במערכת לפני המייל ⇒ סתירה, ושני הערכים נשמרים", () => {
    const result = merge(apartmentEditedInSystem("apt-12"), { apartment: "apt-14" }, at(30), "msg-7");

    expect(result.state.values.apartmentId).toBe("apt-12");
    expect(result.state.meta.APARTMENT).toEqual({
      fromEmail: false,
      systemEditedAt: at(10),
      conflict: true,
      emailValue: { field: "APARTMENT", apartmentId: "apt-14" },
      emailMessageId: "msg-7",
    });
    expect(result.conflictsOpened).toEqual(["APARTMENT"]);
    expect(result.changes).toEqual([]);
  });

  it("EM-C04 — שורה 3: אותו ערך לשדה שנערך במערכת ⇒ אין סתירה ואין שינוי", () => {
    const state = apartmentEditedInSystem("apt-12");
    const result = merge(state, { apartment: "apt-12" }, at(30));

    expect(result.state).toEqual(state);
    expect(result.changes).toEqual([]);
    expect(result.conflictsOpened).toEqual([]);
    expect(result.conflictsClosed).toEqual([]);
  });

  it("EM-C05 — שורה 4: עריכה מאוחרת במערכת מכריעה בלי סתירה, וסוגרת סתירה פתוחה באותו שדה", () => {
    const conflicted = merge(apartmentEditedInSystem("apt-12"), { apartment: "apt-14" }, at(30)).state;
    const edited = applySystemEdit(deepFreeze(conflicted), { field: "APARTMENT", apartmentId: "apt-13" }, at(40));

    expect(edited.values.apartmentId).toBe("apt-13");
    expect(edited.meta.APARTMENT).toEqual({
      fromEmail: false,
      systemEditedAt: at(40),
      conflict: false,
      emailValue: null,
      emailMessageId: null,
    });
    expect(conflictFields(edited.meta)).toEqual([]);
  });

  it("EM-C05 — שורה 4: מייל שהגיע לפני העריכה במערכת ועובד אחריה — המערכת מכריעה והמייל אינו פותח סתירה", () => {
    const state = draft({ values: { apartmentId: "apt-12" }, meta: { APARTMENT: { systemEditedAt: at(40) } } });
    const result = merge(state, { apartment: "apt-14" }, at(30));

    expect(result.state).toEqual(state);
    expect(result.ignored).toEqual(["APARTMENT"]);
    expect(result.conflictsOpened).toEqual([]);
  });

  it("EM-C06 — שורה 5: כמה תשובות לפני הכרעה — הערך מהמייל האחרון מחליף את הממתין (שתי אפשרויות, לא שלוש)", () => {
    const first = merge(apartmentEditedInSystem("apt-12"), { apartment: "apt-14" }, at(30), "msg-1").state;
    const second = merge(first, { apartment: "apt-15" }, at(50), "msg-2");

    expect(second.state.values.apartmentId).toBe("apt-12");
    expect(second.state.meta.APARTMENT.emailValue).toEqual({ field: "APARTMENT", apartmentId: "apt-15" });
    expect(second.state.meta.APARTMENT.emailMessageId).toBe("msg-2");
    expect(second.conflictsOpened).toEqual(["APARTMENT"]);
    expect(second.conflictsClosed).toEqual([]);
  });

  it("EM-C07 — שורה 6: תוספת לתיאור מצורפת ואינה סתירה, גם בתיאור שנערך במערכת", () => {
    const state = draft({
      values: { description: "נזילה בכיור" },
      meta: { DESCRIPTION: { systemEditedAt: at(10) } },
    });
    const result = merge(state, { description: { op: "append", text: "  וגם יש רטיבות   בתקרה " } }, at(30));

    expect(result.state.values.description).toBe("נזילה בכיור\n\nוגם יש רטיבות בתקרה");
    expect(result.state.meta.DESCRIPTION).toMatchObject({ conflict: false, fromEmail: true, systemEditedAt: at(10) });
    expect(result.changes).toEqual([
      { field: "DESCRIPTION", before: "נזילה בכיור", after: "נזילה בכיור\n\nוגם יש רטיבות בתקרה", cause: "email" },
    ]);
    expect(result.conflictsOpened).toEqual([]);
  });

  it("EM-C07 — שורה 6: מייל שאומר במפורש להחליף את התיאור כפוף לכללים — סתירה מול תיאור שנערך במערכת", () => {
    const state = draft({
      values: { description: "נזילה בכיור" },
      meta: { DESCRIPTION: { systemEditedAt: at(10) } },
    });
    const result = merge(state, { description: { op: "replace", text: "רטיבות בתקרה" } }, at(30), "msg-3");

    expect(result.state.values.description).toBe("נזילה בכיור");
    expect(result.state.meta.DESCRIPTION).toMatchObject({
      conflict: true,
      emailValue: { field: "DESCRIPTION", text: "רטיבות בתקרה" },
      emailMessageId: "msg-3",
    });
  });

  it("EM-C08 — שורה 7: תשובה שמוסיפה נמען — הנמען מתווסף בשקט, כנמען מהמייל", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-1"), "SYSTEM")] },
      meta: { RECIPIENTS: { systemEditedAt: at(10) } },
    });
    const result = merge(state, { recipients: { add: [pro("p-2")], remove: [] } }, at(30));

    expect(result.state.values.recipients).toEqual([
      recipient(pro("p-1"), "SYSTEM"),
      recipient(pro("p-2"), "EMAIL"),
    ]);
    expect(result.state.meta.RECIPIENTS).toMatchObject({ fromEmail: true, conflict: false, systemEditedAt: at(10) });
    expect(result.changes).toEqual([
      { field: "RECIPIENTS", before: [pro("p-1")], after: [pro("p-1"), pro("p-2")], cause: "email" },
    ]);
  });

  it("EM-C08 — שורה 8: תשובה שמסירה במפורש נמען שנקבע במערכת ⇒ סתירה, והנמען נשאר", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-1"), "SYSTEM")] },
      meta: { RECIPIENTS: { systemEditedAt: at(10) } },
    });
    const result = merge(state, { recipients: { add: [], remove: [pro("p-1")] } }, at(30), "msg-4");

    expect(result.state.values.recipients).toEqual([recipient(pro("p-1"), "SYSTEM")]);
    expect(result.state.meta.RECIPIENTS).toMatchObject({
      conflict: true,
      emailValue: { field: "RECIPIENTS", add: [], remove: [pro("p-1")] },
      emailMessageId: "msg-4",
    });
    expect(result.conflictsOpened).toEqual(["RECIPIENTS"]);
    expect(result.changes).toEqual([]);
  });

  it("EM-C08 — שורה 9: תשובה שמוסיפה נמען שהוסר במערכת ⇒ סתירה, והנמען אינו חוזר", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-1"), "SYSTEM"), recipient(pro("p-2"), "SYSTEM", at(10))] },
      meta: { RECIPIENTS: { systemEditedAt: at(10) } },
    });
    const result = merge(state, { recipients: { add: [pro("p-2")], remove: [] } }, at(30), "msg-5");

    expect(result.state.values.recipients).toEqual(state.values.recipients);
    expect(result.state.meta.RECIPIENTS).toMatchObject({
      conflict: true,
      emailValue: { field: "RECIPIENTS", add: [pro("p-2")], remove: [] },
      emailMessageId: "msg-5",
    });
  });

  it("EM-C09 — שורה 10: שדה שהוכרע במסך 7א נחשב שנערך במערכת — התג יורד, ותשובה מאוחרת שונה פותחת סתירה חדשה", () => {
    const state = draft({
      values: { domainId: "dom-elec" },
      meta: { DOMAIN: { systemEditedAt: at(10) } },
    });
    const conflicted = merge(state, { domain: "dom-plumb" }, at(30)).state;
    const resolved = resolveChoices(deepFreeze(conflicted), { DOMAIN: "email" }, at(40));

    expect(resolved.values.domainId).toBe("dom-plumb");
    expect(resolved.meta.DOMAIN).toEqual({
      fromEmail: false,
      systemEditedAt: at(40),
      conflict: false,
      emailValue: null,
      emailMessageId: null,
    });

    const later = merge(resolved, { domain: "dom-alu" }, at(50), "msg-9");
    expect(later.state.values.domainId).toBe("dom-plumb");
    expect(later.state.meta.DOMAIN).toMatchObject({ conflict: true, emailValue: { field: "DOMAIN", domainId: "dom-alu" } });
  });

  it("EM-C10 — שורה 11: שינוי אתר בתשובה מאפס בניין ודירה, האיפוס נרשם בערוץ המייל, והנמענים אינם מתאפסים", () => {
    const recipients = [recipient(pro("p-1"), "SYSTEM"), recipient(user("u-1"), "EMAIL")];
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12", recipients },
      meta: {
        SITE: { fromEmail: true },
        BUILDING: { systemEditedAt: at(5) },
        APARTMENT: { fromEmail: true },
        RECIPIENTS: { systemEditedAt: at(5) },
      },
    });
    const result = merge(state, { site: "site-2" }, at(30));

    expect(result.state.values).toMatchObject({ siteId: "site-2", buildingId: null, apartmentId: null });
    expect(result.state.values.recipients).toEqual(recipients);
    expect(result.state.meta.BUILDING).toEqual(emptyDraftMeta().BUILDING);
    expect(result.state.meta.APARTMENT).toEqual(emptyDraftMeta().APARTMENT);
    expect(result.state.meta.RECIPIENTS.systemEditedAt).toEqual(at(5));
    expect(result.changes).toEqual([
      { field: "SITE", before: "site-1", after: "site-2", cause: "email" },
      { field: "BUILDING", before: "bld-a", after: null, cause: "reset" },
      { field: "APARTMENT", before: "apt-12", after: null, cause: "reset" },
    ]);
  });

  it("EM-C10 — שורה 11: שינוי בניין בתשובה מאפס דירה בלבד", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12", room: "SALON" },
      meta: { BUILDING: { fromEmail: true }, APARTMENT: { fromEmail: true } },
    });
    const result = merge(state, { building: "bld-b" }, at(30));

    expect(result.state.values).toMatchObject({ siteId: "site-1", buildingId: "bld-b", apartmentId: null, room: "SALON" });
    expect(result.changes).toEqual([
      { field: "BUILDING", before: "bld-a", after: "bld-b", cause: "email" },
      { field: "APARTMENT", before: "apt-12", after: null, cause: "reset" },
    ]);
  });
});

// ───────────────────── §3.5 — "סתירה פתוחה" והיציאה ממנה ─────────────────────

describe("§3.5 — סתירה פתוחה", () => {
  it("EM-C01 — הסתירה היא דגל על השדה: הערך במערכת נשאר, ו-conflictFields מחזיר את השדה (השיגור נחסם לפיו)", () => {
    const result = merge(apartmentEditedInSystem("apt-12"), { apartment: "apt-14", room: "KITCHEN" }, at(30));

    expect(conflictFields(result.state.meta)).toEqual(["APARTMENT"]);
    expect(result.state.values.apartmentId).toBe("apt-12");
    expect(result.state.values.room).toBe("KITCHEN");
  });

  it("EM-C02 — יציאה 1: הכרעה במסך 7א", () => {
    const conflicted = merge(apartmentEditedInSystem("apt-12"), { apartment: "apt-14" }, at(30)).state;
    const resolved = resolveChoices(conflicted, { APARTMENT: "system" }, at(40));

    expect(conflictFields(resolved.meta)).toEqual([]);
  });

  it("EM-C02 — יציאה 2: עריכה במערכת אחרי המייל, גם בלי שינוי ערך (שמירה מפורשת היא בדיקה)", () => {
    const conflicted = merge(apartmentEditedInSystem("apt-12"), { apartment: "apt-14" }, at(30)).state;
    const edited = applySystemEdit(conflicted, { field: "APARTMENT", apartmentId: "apt-12" }, at(40));

    expect(conflictFields(edited.meta)).toEqual([]);
    expect(edited.meta.APARTMENT.systemEditedAt).toEqual(at(40));
  });

  it("EM-C02 — יציאה 3: תשובה מאוחרת שנותנת לשדה את הערך שבמערכת סוגרת את הסתירה", () => {
    const conflicted = merge(apartmentEditedInSystem("apt-12"), { apartment: "apt-14" }, at(30), "msg-1").state;
    const result = merge(conflicted, { apartment: "apt-12" }, at(50), "msg-2");

    expect(result.state.meta.APARTMENT).toEqual({
      fromEmail: false,
      systemEditedAt: at(10),
      conflict: false,
      emailValue: null,
      emailMessageId: null,
    });
    expect(result.conflictsClosed).toEqual(["APARTMENT"]);
    expect(result.changes).toEqual([]);
  });
});

// ─────────────────────────────── תיאור ───────────────────────────────

describe("EM-C07 — תיאור", () => {
  it("EM-C07 — תוספת לתיאור ריק היא התיאור עצמו, מנורמל", () => {
    const result = merge(draft(), { description: { op: "append", text: "נזילה\r\n\r\n\r\n  בכיור " } }, at(30));

    expect(result.state.values.description).toBe("נזילה\n\nבכיור");
  });

  it("EM-C07 — תוספת אינה נדחית גם כשהעריכה במערכת מאוחרת מהמייל, ואינה מכריעה סתירה פתוחה בתיאור", () => {
    const state = draft({
      values: { description: "נזילה" },
      meta: {
        DESCRIPTION: {
          systemEditedAt: at(40),
          conflict: true,
          emailValue: { field: "DESCRIPTION", text: "רטיבות" },
          emailMessageId: "msg-1",
        },
      },
    });
    const result = merge(state, { description: { op: "append", text: "גם בתקרה" } }, at(30), "msg-2");

    expect(result.state.values.description).toBe("נזילה\n\nגם בתקרה");
    expect(result.state.meta.DESCRIPTION).toMatchObject({
      conflict: true,
      emailValue: { field: "DESCRIPTION", text: "רטיבות" },
      emailMessageId: "msg-1",
      fromEmail: true,
    });
    expect(result.ignored).toEqual([]);
    expect(result.conflictsClosed).toEqual([]);
  });

  it.each(["append", "set", "replace"] as const)("EM-C07 — טקסט ריק או רווחים בלבד (%s) אינו משנה דבר", (op) => {
    const state = draft({ values: { description: "נזילה" } });
    const result = merge(state, { description: { op, text: " \n\t " } }, at(30));

    expect(result.state).toEqual(state);
    expect(result.changes).toEqual([]);
  });

  it("EM-C03 — set לתיאור שלא נערך במערכת מחליף בשקט, מנורמל", () => {
    const state = draft({ values: { description: "נזילה" }, meta: { DESCRIPTION: { fromEmail: true } } });
    const result = merge(state, { description: { op: "set", text: "  רטיבות   בתקרה  " } }, at(30));

    expect(result.state.values.description).toBe("רטיבות בתקרה");
    expect(result.changes).toEqual([{ field: "DESCRIPTION", before: "נזילה", after: "רטיבות בתקרה", cause: "email" }]);
  });

  it("EM-C04 — replace בטקסט זהה לתיאור שנערך במערכת (אחרי נרמול) אינו סתירה", () => {
    const state = draft({ values: { description: "נזילה בכיור" }, meta: { DESCRIPTION: { systemEditedAt: at(10) } } });
    const result = merge(state, { description: { op: "replace", text: " נזילה   בכיור " } }, at(30));

    expect(result.state).toEqual(state);
  });
});

// ─────────────────────────────── נמענים ───────────────────────────────

describe("EM-C08 — נמענים, ברמת פריט", () => {
  const systemEdited = { RECIPIENTS: { systemEditedAt: at(10) } };

  it("EM-C08 — הסרה של נמען שנוסף ממייל ולא נערך במערכת — מוסר לגמרי, בשקט", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-1"), "SYSTEM"), recipient(pro("p-2"), "EMAIL")] },
      meta: { RECIPIENTS: { systemEditedAt: at(10), fromEmail: true } },
    });
    const result = merge(state, { recipients: { add: [], remove: [pro("p-2")] } }, at(30));

    expect(result.state.values.recipients).toEqual([recipient(pro("p-1"), "SYSTEM")]);
    expect(result.state.meta.RECIPIENTS.conflict).toBe(false);
    expect(result.changes).toEqual([
      { field: "RECIPIENTS", before: [pro("p-1"), pro("p-2")], after: [pro("p-1")], cause: "email" },
    ]);
  });

  it("EM-C08 — הוספת נמען שכבר פעיל אינה משנה דבר", () => {
    const state = draft({ values: { recipients: [recipient(pro("p-1"), "SYSTEM")] }, meta: systemEdited });
    const result = merge(state, { recipients: { add: [pro("p-1")], remove: [] } }, at(30));

    expect(result.state).toEqual(state);
    expect(result.changes).toEqual([]);
  });

  it("EM-C08 — הסרת נמען שאינו ברשימה אינה משנה דבר", () => {
    const state = draft({ values: { recipients: [recipient(pro("p-1"), "SYSTEM")] }, meta: systemEdited });
    const result = merge(state, { recipients: { add: [], remove: [pro("p-9")] } }, at(30));

    expect(result.state).toEqual(state);
  });

  it("EM-C08 — אותו id אצל איש מקצוע ומשתמש הוא שני נמענים שונים", () => {
    const state = draft({ values: { recipients: [recipient(pro("x-1"), "SYSTEM")] }, meta: systemEdited });
    const result = merge(state, { recipients: { add: [user("x-1")], remove: [] } }, at(30));

    expect(result.state.values.recipients).toEqual([recipient(pro("x-1"), "SYSTEM"), recipient(user("x-1"), "EMAIL")]);
  });

  it("EM-C05 — הוספת נמען שהוסר במערכת אחרי שהמייל הגיע — המערכת מכריעה, בלי סתירה", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-2"), "SYSTEM", at(40))] },
      meta: { RECIPIENTS: { systemEditedAt: at(40) } },
    });
    const result = merge(state, { recipients: { add: [pro("p-2")], remove: [] } }, at(30));

    expect(result.state).toEqual(state);
    expect(result.ignored).toEqual(["RECIPIENTS"]);
  });

  it("EM-C05 — הסרת נמען מהמערכת כשהרשימה נערכה במערכת אחרי המייל — המערכת מכריעה", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-1"), "SYSTEM")] },
      meta: { RECIPIENTS: { systemEditedAt: at(40) } },
    });
    const result = merge(state, { recipients: { add: [], remove: [pro("p-1")] } }, at(30));

    expect(result.state).toEqual(state);
    expect(result.ignored).toEqual(["RECIPIENTS"]);
  });

  it("EM-C08 — גבול הזמן: נמען שהוסר במערכת בדיוק ברגע הגעת המייל — הוספתו סתירה ולא התעלמות", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-2"), "SYSTEM", at(30))] },
      meta: { RECIPIENTS: { systemEditedAt: at(30) } },
    });
    const result = merge(state, { recipients: { add: [pro("p-2")], remove: [] } }, at(30), "msg-6");

    expect(result.ignored).toEqual([]);
    expect(result.state.meta.RECIPIENTS).toMatchObject({
      conflict: true,
      emailValue: { field: "RECIPIENTS", add: [pro("p-2")], remove: [] },
    });
  });

  it("EM-C08 — גבול הזמן: רשימה שנערכה במערכת בדיוק ברגע הגעת המייל — הסרת נמען מהמערכת היא סתירה", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-1"), "SYSTEM")] },
      meta: { RECIPIENTS: { systemEditedAt: at(30) } },
    });
    const result = merge(state, { recipients: { add: [], remove: [pro("p-1")] } }, at(30));

    expect(result.ignored).toEqual([]);
    expect(result.state.meta.RECIPIENTS.conflict).toBe(true);
  });

  it("EM-C08 — מצבה עם חותמת זמן בלתי קריאה נחשבת הסרה קודמת: סתירה ולא התעלמות", () => {
    const tombstone: DraftRecipient = { ...pro("p-2"), origin: "SYSTEM", removedBySystemAt: "garbage" };
    const state = draft({ values: { recipients: [tombstone] }, meta: systemEdited });
    const result = merge(state, { recipients: { add: [pro("p-2")], remove: [] } }, at(30));

    expect(result.state.meta.RECIPIENTS.conflict).toBe(true);
  });

  it("EM-C06 — פריט שמוזכר שוב במייל מאוחר מחליף את הממתין שלו; פריטים שלא הוזכרו נשארים ממתינים", () => {
    const state = draft({
      values: {
        recipients: [
          recipient(pro("p-1"), "SYSTEM"),
          recipient(pro("p-3"), "SYSTEM"),
          recipient(pro("p-2"), "SYSTEM", at(10)),
        ],
      },
      meta: systemEdited,
    });
    const first = merge(state, { recipients: { add: [pro("p-2")], remove: [pro("p-1")] } }, at(30), "msg-1").state;
    expect(first.meta.RECIPIENTS.emailValue).toEqual({ field: "RECIPIENTS", add: [pro("p-2")], remove: [pro("p-1")] });

    // המייל המאוחר חוזר בו מהוספת p-2 (מבקש להסיר אותו — וזה כבר המצב במערכת),
    // ומבקש להסיר גם את p-3. הבקשה להסיר את p-1 לא הוזכרה ונשארת.
    const second = merge(first, { recipients: { add: [], remove: [pro("p-2"), pro("p-3")] } }, at(50), "msg-2");

    expect(second.state.meta.RECIPIENTS).toMatchObject({
      conflict: true,
      emailValue: { field: "RECIPIENTS", add: [], remove: [pro("p-1"), pro("p-3")] },
      emailMessageId: "msg-2",
    });
    expect(second.state.values.recipients).toEqual(state.values.recipients);
  });

  it("EM-C02 — תשובה מאוחרת שחוזרת למצב שבמערכת בכל הפריטים סוגרת את סתירת הנמענים", () => {
    const state = draft({ values: { recipients: [recipient(pro("p-1"), "SYSTEM")] }, meta: systemEdited });
    const conflicted = merge(state, { recipients: { add: [], remove: [pro("p-1")] } }, at(30), "msg-1").state;
    const result = merge(conflicted, { recipients: { add: [pro("p-1")], remove: [] } }, at(50), "msg-2");

    expect(result.state.meta.RECIPIENTS).toMatchObject({ conflict: false, emailValue: null, emailMessageId: null });
    expect(result.conflictsClosed).toEqual(["RECIPIENTS"]);
  });

  it("EM-C08 — מייל שסוגר פריט אחד בלבד משאיר את הסתירה פתוחה ואת מזהה המייל שהציע את הנותר", () => {
    const state = draft({
      values: { recipients: [recipient(pro("p-1"), "SYSTEM"), recipient(pro("p-2"), "SYSTEM")] },
      meta: systemEdited,
    });
    const conflicted = merge(state, { recipients: { add: [], remove: [pro("p-1"), pro("p-2")] } }, at(30), "msg-1").state;
    const result = merge(conflicted, { recipients: { add: [pro("p-1")], remove: [] } }, at(50), "msg-2");

    expect(result.state.meta.RECIPIENTS).toMatchObject({
      conflict: true,
      emailValue: { field: "RECIPIENTS", add: [], remove: [pro("p-2")] },
      emailMessageId: "msg-1",
    });
    expect(result.conflictsOpened).toEqual([]);
    expect(result.conflictsClosed).toEqual([]);
  });

  it("EM-C08 — אותו נמען גם בהוספה וגם בהסרה באותו מייל — הוראה סותרת, ולא נעשה דבר", () => {
    const state = draft({ values: { recipients: [recipient(pro("p-1"), "SYSTEM")] }, meta: systemEdited });
    const result = merge(state, { recipients: { add: [pro("p-2"), pro("p-1")], remove: [pro("p-1"), pro("p-2")] } }, at(30));

    expect(result.state).toEqual(state);
    expect(result.changes).toEqual([]);
  });

  it("EM-C08 — נמען שמופיע פעמיים בהוספה נוסף פעם אחת", () => {
    const result = merge(draft(), { recipients: { add: [pro("p-1"), pro("p-1")], remove: [] } }, at(30));

    expect(result.state.values.recipients).toEqual([recipient(pro("p-1"), "EMAIL")]);
  });

  it("EM-C08 — הוספה ששינתה את הרשימה והסרה שנכנסה לסתירה באותו מייל: שינוי אחד וסתירה אחת", () => {
    const state = draft({ values: { recipients: [recipient(pro("p-1"), "SYSTEM")] }, meta: systemEdited });
    const result = merge(state, { recipients: { add: [pro("p-2")], remove: [pro("p-1")] } }, at(30), "msg-1");

    expect(result.state.values.recipients).toEqual([recipient(pro("p-1"), "SYSTEM"), recipient(pro("p-2"), "EMAIL")]);
    expect(result.changes).toHaveLength(1);
    expect(result.conflictsOpened).toEqual(["RECIPIENTS"]);
    expect(result.state.meta.RECIPIENTS).toMatchObject({ fromEmail: true, conflict: true });
  });
});

// ─────────────────────────── שדות תלויים ───────────────────────────

describe("EM-C10 — שדות תלויים", () => {
  it("EM-C10 — שינוי אתר בתשובה מאפס בניין ודירה, והבניין והדירה מאותה תשובה נכנסים — שינוי אחד לכל שדה", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12" },
      meta: { SITE: { fromEmail: true }, BUILDING: { systemEditedAt: at(10) }, APARTMENT: { systemEditedAt: at(10) } },
    });
    const result = merge(state, { site: "site-2", building: "bld-x", apartment: "apt-3" }, at(30));

    expect(result.state.values).toMatchObject({ siteId: "site-2", buildingId: "bld-x", apartmentId: "apt-3" });
    expect(result.state.meta.BUILDING).toMatchObject({ fromEmail: true, systemEditedAt: null, conflict: false });
    expect(result.changes).toEqual([
      { field: "SITE", before: "site-1", after: "site-2", cause: "email" },
      { field: "BUILDING", before: "bld-a", after: "bld-x", cause: "email" },
      { field: "APARTMENT", before: "apt-12", after: "apt-3", cause: "email" },
    ]);
    expect(result.conflictsOpened).toEqual([]);
  });

  it("EM-C10 — איפוס סוגר סתירה פתוחה בשדה התלוי, גם כשערכו ריק", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: null },
      meta: {
        BUILDING: { fromEmail: true },
        APARTMENT: {
          systemEditedAt: at(10),
          conflict: true,
          emailValue: { field: "APARTMENT", apartmentId: "apt-14" },
          emailMessageId: "msg-1",
        },
      },
    });
    const result = merge(state, { building: "bld-b" }, at(30), "msg-2");

    expect(result.state.meta.APARTMENT).toEqual(emptyDraftMeta().APARTMENT);
    expect(result.conflictsClosed).toEqual(["APARTMENT"]);
    // ערך הדירה היה ריק ממילא — אין מה לדווח לשולח
    expect(result.changes).toEqual([{ field: "BUILDING", before: "bld-a", after: "bld-b", cause: "email" }]);
  });

  it("EM-C10 — אתר מהתשובה שנכנס לסתירה: בניין ודירה מאותה תשובה אינם ממוזגים", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12" },
      meta: { SITE: { systemEditedAt: at(10) } },
    });
    const result = merge(state, { site: "site-2", building: "bld-x", apartment: "apt-3", room: "WC" }, at(30));

    expect(result.state.values).toMatchObject({ siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12", room: "WC" });
    expect(result.conflictsOpened).toEqual(["SITE"]);
    expect(result.skippedDependents).toEqual(["BUILDING", "APARTMENT"]);
    expect(result.state.meta.BUILDING).toEqual(emptyDraftMeta().BUILDING);
  });

  it("EM-C10 — בניין מהתשובה שהמערכת מכריעה נגדו: הדירה מאותה תשובה אינה ממוזגת", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: null },
      meta: { BUILDING: { systemEditedAt: at(40) } },
    });
    const result = merge(state, { building: "bld-b", apartment: "apt-3" }, at(30));

    expect(result.state.values.apartmentId).toBeNull();
    expect(result.ignored).toEqual(["BUILDING"]);
    expect(result.skippedDependents).toEqual(["APARTMENT"]);
  });

  it("EM-C10 — אתר זהה לקיים אינו חוסם את הבניין מאותה תשובה", () => {
    const state = draft({ values: { siteId: "site-1" }, meta: { SITE: { systemEditedAt: at(10) } } });
    const result = merge(state, { site: "site-1", building: "bld-a" }, at(30));

    expect(result.state.values.buildingId).toBe("bld-a");
    expect(result.skippedDependents).toEqual([]);
  });

  it("EM-C10 — אתר זהה לקיים שנשמר במערכת אחרי המייל אינו חוסם את הבניין: הבניין שייך לאתר של הטיוטה", () => {
    // שמירה מפורשת של אותו אתר (בדקה 40) מאוחרת מהמייל (בדקה 30), ולכן האתר
    // "נזנח". אבל המייל והטיוטה מדברים על אותו אתר, כך שהבניין מהמייל הותאם
    // מול אתר הטיוטה — ואין סיבה לזרוק אותו. הכלל חל על כל שדה בנפרד (§5.ה4).
    const state = draft({ values: { siteId: "site-1" }, meta: { SITE: { systemEditedAt: at(40) } } });
    const result = merge(state, { site: "site-1", building: "bld-a", apartment: "apt-3" }, at(30));

    expect(result.state.values).toMatchObject({ siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-3" });
    expect(result.skippedDependents).toEqual([]);
    expect(result.state.meta.SITE.systemEditedAt).toEqual(at(40));
  });

  it("EM-C10 — בניין זהה לקיים שנשמר במערכת אחרי המייל אינו חוסם את הדירה", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a" },
      meta: { BUILDING: { systemEditedAt: at(40) } },
    });
    const result = merge(state, { building: "bld-a", apartment: "apt-3" }, at(30));

    expect(result.state.values.apartmentId).toBe("apt-3");
    expect(result.skippedDependents).toEqual([]);
  });

  it("EM-C10 — שינוי אתר במערכת מאפס בניין ודירה, והשדות נשארים לא-ערוכים: מייל מאוחר ממלא אותם בשקט", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12", recipients: [recipient(pro("p-1"), "EMAIL")] },
      meta: { BUILDING: { systemEditedAt: at(5) }, APARTMENT: { fromEmail: true } },
    });
    const edited = applySystemEdit(deepFreeze(state), { field: "SITE", siteId: "site-2" }, at(20));

    expect(edited.values).toMatchObject({ siteId: "site-2", buildingId: null, apartmentId: null });
    expect(edited.values.recipients).toEqual(state.values.recipients);
    expect(edited.meta.BUILDING).toEqual(emptyDraftMeta().BUILDING);
    expect(edited.meta.APARTMENT).toEqual(emptyDraftMeta().APARTMENT);
    expect(edited.meta.SITE).toMatchObject({ systemEditedAt: at(20), fromEmail: false });

    const later = merge(edited, { building: "bld-x" }, at(30));
    expect(later.state.values.buildingId).toBe("bld-x");
    expect(later.conflictsOpened).toEqual([]);
  });

  it("EM-C10 — שינוי בניין במערכת מאפס דירה בלבד", () => {
    const state = draft({ values: { siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12" } });
    const edited = applySystemEdit(state, { field: "BUILDING", buildingId: "bld-b" }, at(20));

    expect(edited.values).toMatchObject({ siteId: "site-1", buildingId: "bld-b", apartmentId: null });
  });

  it("EM-C10 — שמירת אותו אתר במערכת אינה מאפסת את התלויים", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12" },
      meta: { BUILDING: { fromEmail: true } },
    });
    const edited = applySystemEdit(state, { field: "SITE", siteId: "site-1" }, at(20));

    expect(edited.values).toMatchObject({ buildingId: "bld-a", apartmentId: "apt-12" });
    expect(edited.meta.BUILDING.fromEmail).toBe(true);
    expect(edited.meta.SITE.systemEditedAt).toEqual(at(20));
  });
});

// ───────────────────────────── applySystemEdit ─────────────────────────────

describe("EM-C05 — applySystemEdit", () => {
  it("EM-C05 — עריכת תיאור במערכת עוברת נרמול ומורידה את תג \"מהמייל\"", () => {
    const state = draft({ values: { description: "נזילה" }, meta: { DESCRIPTION: { fromEmail: true } } });
    const edited = applySystemEdit(state, { field: "DESCRIPTION", text: "  נזילה   בכיור \r\n" }, at(20));

    expect(edited.values.description).toBe("נזילה בכיור");
    expect(edited.meta.DESCRIPTION).toMatchObject({ fromEmail: false, systemEditedAt: at(20) });
  });

  it("EM-C05 — עריכת חדר לריק במערכת", () => {
    const state = draft({ values: { room: "KITCHEN" }, meta: { ROOM: { fromEmail: true } } });
    const edited = applySystemEdit(state, { field: "ROOM", room: null }, at(20));

    expect(edited.values.room).toBeNull();
    expect(edited.meta.ROOM.systemEditedAt).toEqual(at(20));
  });

  it("EM-C08 — עריכת נמענים במערכת: מי שירד נשאר כמצבה, מי שברשימה פעיל ו-SYSTEM, מצבות קודמות נשארות", () => {
    const state = draft({
      values: {
        recipients: [
          recipient(pro("p-1"), "EMAIL"),
          recipient(pro("p-2"), "SYSTEM"),
          recipient(pro("p-3"), "SYSTEM", at(5)),
        ],
      },
      meta: { RECIPIENTS: { fromEmail: true } },
    });
    const edited = applySystemEdit(deepFreeze(state), { field: "RECIPIENTS", recipients: [user("u-1"), pro("p-1")] }, at(20));

    expect(edited.values.recipients).toEqual([
      recipient(user("u-1"), "SYSTEM"),
      recipient(pro("p-1"), "SYSTEM"),
      recipient(pro("p-2"), "SYSTEM", at(20)),
      recipient(pro("p-3"), "SYSTEM", at(5)),
    ]);
    expect(edited.meta.RECIPIENTS).toMatchObject({ fromEmail: false, systemEditedAt: at(20), conflict: false });
  });

  it("EM-C08 — נמען שהוסר במערכת ומוחזר במערכת חוזר לחיים (המצבה מתבטלת)", () => {
    const state = draft({ values: { recipients: [recipient(pro("p-2"), "SYSTEM", at(5))] } });
    const edited = applySystemEdit(state, { field: "RECIPIENTS", recipients: [pro("p-2")] }, at(20));

    expect(edited.values.recipients).toEqual([recipient(pro("p-2"), "SYSTEM")]);

    // ומרגע שחזר, הסרה שלו בתשובה מאוחרת היא סתירה ולא הסרה שקטה
    const later = merge(edited, { recipients: { add: [], remove: [pro("p-2")] } }, at(30));
    expect(later.state.meta.RECIPIENTS.conflict).toBe(true);
  });

  it("EM-C05 — עריכת נמענים במערכת סוגרת סתירת נמענים פתוחה", () => {
    const state = draft({ values: { recipients: [recipient(pro("p-1"), "SYSTEM")] }, meta: { RECIPIENTS: { systemEditedAt: at(10) } } });
    const conflicted = merge(state, { recipients: { add: [], remove: [pro("p-1")] } }, at(30)).state;
    const edited = applySystemEdit(conflicted, { field: "RECIPIENTS", recipients: [pro("p-1")] }, at(40));

    expect(edited.meta.RECIPIENTS).toMatchObject({ conflict: false, emailValue: null, emailMessageId: null });
  });
});

// ───────────────────────────── resolveChoices ─────────────────────────────

describe("EM-C09 — resolveChoices (מסך 7א)", () => {
  function conflictedDraft(): DraftState {
    const state = draft({
      values: {
        siteId: "site-1",
        buildingId: "bld-a",
        apartmentId: "apt-12",
        domainId: "dom-elec",
        description: "נזילה",
        recipients: [recipient(pro("p-1"), "SYSTEM"), recipient(pro("p-2"), "SYSTEM", at(5)), recipient(pro("p-4"), "EMAIL")],
      },
      meta: {
        APARTMENT: { systemEditedAt: at(10) },
        DOMAIN: { systemEditedAt: at(10) },
        DESCRIPTION: { systemEditedAt: at(10) },
        RECIPIENTS: { systemEditedAt: at(10), fromEmail: true },
      },
    });
    return merge(
      state,
      {
        apartment: "apt-14",
        domain: "dom-plumb",
        description: { op: "replace", text: "רטיבות" },
        recipients: { add: [pro("p-2")], remove: [pro("p-1")] },
      },
      at(30),
    ).state;
  }

  it("EM-C09 — בחירה בצד המייל בשדות סקלריים ובתיאור: הערך מהמייל נכתב כעריכה במערכת", () => {
    const resolved = resolveChoices(deepFreeze(conflictedDraft()), { APARTMENT: "email", DESCRIPTION: "email" }, at(40));

    expect(resolved.values.apartmentId).toBe("apt-14");
    expect(resolved.values.description).toBe("רטיבות");
    for (const field of ["APARTMENT", "DESCRIPTION"] as const) {
      expect(resolved.meta[field]).toEqual({
        fromEmail: false,
        systemEditedAt: at(40),
        conflict: false,
        emailValue: null,
        emailMessageId: null,
      });
    }
    // שדות שלא נבחר בהם ערך נשארים בסתירה
    expect(conflictFields(resolved.meta)).toEqual(["DOMAIN", "RECIPIENTS"]);
  });

  it("EM-C09 — בחירה בצד המערכת: הערך נשאר, אבל ההכרעה נחשבת עריכה במערכת", () => {
    const resolved = resolveChoices(conflictedDraft(), { DOMAIN: "system" }, at(40));

    expect(resolved.values.domainId).toBe("dom-elec");
    expect(resolved.meta.DOMAIN).toEqual({
      fromEmail: false,
      systemEditedAt: at(40),
      conflict: false,
      emailValue: null,
      emailMessageId: null,
    });
  });

  it("EM-C09 — נמענים, צד המייל: ההוספה מחיה את המצבה, ההסרה הופכת למצבה, וכל הפעילים SYSTEM", () => {
    const resolved = resolveChoices(conflictedDraft(), { RECIPIENTS: "email" }, at(40));

    expect(resolved.values.recipients).toEqual([
      recipient(pro("p-4"), "SYSTEM"),
      recipient(pro("p-2"), "SYSTEM"),
      recipient(pro("p-1"), "SYSTEM", at(40)),
    ]);
    expect(resolved.meta.RECIPIENTS).toMatchObject({ fromEmail: false, systemEditedAt: at(40), conflict: false, emailValue: null });
  });

  it("EM-C09 — נמענים, צד המערכת: הרשימה נשארת, והנמען שנוסף ממייל הופך ל-SYSTEM", () => {
    const before = conflictedDraft();
    const resolved = resolveChoices(before, { RECIPIENTS: "system" }, at(40));

    expect(resolved.values.recipients).toEqual([
      recipient(pro("p-1"), "SYSTEM"),
      recipient(pro("p-4"), "SYSTEM"),
      recipient(pro("p-2"), "SYSTEM", at(5)),
    ]);
    expect(resolved.meta.RECIPIENTS).toMatchObject({ fromEmail: false, systemEditedAt: at(40), conflict: false });

    // ומרגע ההכרעה, הסרת p-4 בתשובה מאוחרת היא סתירה
    const later = merge(resolved, { recipients: { add: [], remove: [pro("p-4")] } }, at(50));
    expect(later.state.meta.RECIPIENTS.conflict).toBe(true);
  });

  it("EM-C10 — הכרעת אתר לצד המייל מאפסת את התלויים וסוגרת את הסתירות שלהם; הבחירות בהם אינן חלות", () => {
    const state = draft({
      values: { siteId: "site-1", buildingId: "bld-a", apartmentId: "apt-12" },
      meta: {
        SITE: { systemEditedAt: at(10), conflict: true, emailValue: { field: "SITE", siteId: "site-2" }, emailMessageId: "m" },
        BUILDING: { systemEditedAt: at(10), conflict: true, emailValue: { field: "BUILDING", buildingId: "bld-x" }, emailMessageId: "m" },
      },
    });
    const resolved = resolveChoices(state, { SITE: "email", BUILDING: "email" }, at(40));

    expect(resolved.values).toMatchObject({ siteId: "site-2", buildingId: null, apartmentId: null });
    expect(resolved.meta.BUILDING).toEqual(emptyDraftMeta().BUILDING);
    expect(conflictFields(resolved.meta)).toEqual([]);
  });

  it("EM-C09 — בחירה לשדה שאינו בסתירה אינה חלה", () => {
    const state = draft({ values: { room: "KITCHEN" }, meta: { ROOM: { fromEmail: true } } });
    const resolved = resolveChoices(state, { ROOM: "system", SITE: "email" }, at(40));

    expect(resolved).toEqual(state);
  });

  it("EM-C09 — סתירה בלי ערך מהמייל שמור (מצב פגום): בחירה בצד המייל אינה ממציאה ערך והסתירה נשארת", () => {
    const state = draft({ values: { domainId: "dom-elec" }, meta: { DOMAIN: { systemEditedAt: at(10), conflict: true } } });
    const resolved = resolveChoices(state, { DOMAIN: "email" }, at(40));

    expect(resolved).toEqual(state);
  });
});

// ─────────────────────────────── כללי ───────────────────────────────

describe("המנוע — תכונות כלליות", () => {
  it("EM-C03 — הצעה ריקה אינה משנה דבר, והמצב המוחזר הוא אובייקט חדש", () => {
    const state = apartmentEditedInSystem();
    const result = merge(state, {}, at(30));

    expect(result.state).toEqual(state);
    expect(result.state).not.toBe(state);
    expect(result.state.values.recipients).not.toBe(state.values.recipients);
    expect(result).toMatchObject({ changes: [], conflictsOpened: [], conflictsClosed: [], ignored: [], skippedDependents: [] });
  });

  it("EM-C03 — מזהה ריק בהצעה נחשב כאילו השדה לא הוזכר", () => {
    const state = draft({ values: { siteId: "site-1" } });
    const result = merge(state, { site: "  ", building: "" }, at(30));

    expect(result.state).toEqual(state);
  });

  it("EM-C01…EM-C10 — הקלט אינו משתנה — גם כשהמנוע משנה כל שדה", () => {
    const state = draft({
      values: {
        siteId: "site-1",
        buildingId: "bld-a",
        apartmentId: "apt-12",
        description: "נזילה",
        recipients: [recipient(pro("p-1"), "SYSTEM"), recipient(pro("p-2"), "EMAIL")],
      },
      meta: { RECIPIENTS: { systemEditedAt: at(10) }, DOMAIN: { systemEditedAt: at(10) } },
    });
    const snapshot = structuredCloneJson(state);
    const proposal: EmailProposal = {
      site: "site-2",
      building: "bld-x",
      apartment: "apt-3",
      room: "WC",
      domain: "dom-plumb",
      description: { op: "append", text: "עוד" },
      recipients: { add: [pro("p-3")], remove: [pro("p-1"), pro("p-2")] },
    };
    // ההקפאה העמוקה בתוך `merge` מפילה כל כתיבה לקלט; ההשוואה תופסת גם החלפה
    const result = merge(state, proposal, at(30));
    const resolved = resolveChoices(deepFreeze(result.state), { DOMAIN: "email", RECIPIENTS: "email" }, at(40));
    applySystemEdit(deepFreeze(resolved), { field: "RECIPIENTS", recipients: [] }, at(50));

    expect(structuredCloneJson(state)).toEqual(snapshot);
  });

  it("EM-C05 — זמן הגעה בלתי תקין הוא באג ולא החלטה — המנוע זורק", () => {
    expect(() => merge(draft(), { room: "WC" }, new Date("invalid"))).toThrow();
    expect(() => applySystemEdit(draft(), { field: "ROOM", room: "WC" }, new Date(Number.NaN))).toThrow();
    expect(() => resolveChoices(draft(), {}, new Date(Number.NaN))).toThrow();
  });
});

function structuredCloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
