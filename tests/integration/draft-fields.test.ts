import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { activeRecipients, parseDraftRecipients } from "@/lib/draft/fields";
import { applySystemEdit, mergeEmailIntoDraft } from "@/lib/draft/merge";
import { conflictsVersion, toDraftState } from "@/lib/draft/state";
import { he } from "@/lib/he";
import {
  loadDraftState,
  removeDraftMedia,
  resolveDraftConflicts,
  updateDraftFields,
} from "@/lib/services/draft-fields";
import { submitDraft, updateTicketFields } from "@/lib/services/tickets";
import { type SessionUser, toViewer } from "@/lib/session";
import { resetDb } from "../helpers/reset-db";

/**
 * צד המערכת של הטיוטה (S4): עריכה דרך מנוע המיזוג, חסימת שיגור בסתירה,
 * הכרעה בחלון הסתירות והסרת מדיה — מול בסיס נתונים אמיתי.
 *
 * מה שנבדק כאן ואינו נבדק ביחידה: מה באמת נכתב לשורות, מה קורה תחת הרשאה
 * אחרת, ומה קורה כשהמצב משתנה בין הקריאה לכתיבה.
 */

let admin: SessionUser;
let manager: SessionUser;
let otherManager: SessionUser;
let siteId: string;
let otherSiteId: string;
let buildingId: string;
let apartmentId: string;
let otherBuildingId: string;
let domainId: string;
let otherDomainId: string;
let professionalId: string;
let inactiveProfessionalId: string;

beforeEach(async () => {
  await resetDb();

  siteId = (await db.site.create({ data: { name: "אתר א" } })).id;
  otherSiteId = (await db.site.create({ data: { name: "אתר ב" } })).id;
  buildingId = (await db.building.create({ data: { siteId, name: "בניין א" } })).id;
  apartmentId = (await db.apartment.create({ data: { buildingId, number: "7" } })).id;
  otherBuildingId = (await db.building.create({ data: { siteId: otherSiteId, name: "בניין ב" } })).id;
  domainId = (await db.domain.create({ data: { name: "חשמל" } })).id;
  otherDomainId = (await db.domain.create({ data: { name: "אינסטלציה" } })).id;
  professionalId = (await db.professional.create({ data: { name: "יוסי", phone: "0501234567" } })).id;
  inactiveProfessionalId = (
    await db.professional.create({ data: { name: "מושבת", phone: "0507654321", active: false } })
  ).id;

  const adminRow = await db.user.create({
    data: { role: "ADMIN", name: "מנהלת מערכת", phone: "0500000000", passwordHash: "x" },
  });
  admin = { id: adminRow.id, name: adminRow.name, role: adminRow.role, siteId: adminRow.siteId };

  const managerRow = await db.user.create({
    data: { role: "SITE_MANAGER", name: "מנהל א", phone: "0500000001", passwordHash: "x", siteId },
  });
  manager = { id: managerRow.id, name: managerRow.name, role: managerRow.role, siteId: managerRow.siteId };

  const otherRow = await db.user.create({
    data: {
      role: "SITE_MANAGER",
      name: "מנהל ב",
      phone: "0500000002",
      passwordHash: "x",
      siteId: otherSiteId,
    },
  });
  otherManager = { id: otherRow.id, name: otherRow.name, role: otherRow.role, siteId: otherRow.siteId };
});

afterAll(async () => {
  await db.$disconnect();
});

async function emailDraft(overrides: Record<string, unknown> = {}) {
  return db.ticket.create({
    data: {
      channel: "EMAIL",
      isDraft: true,
      siteId,
      createdById: admin.id,
      description: "נזילה במקלחת",
      ...overrides,
    },
  });
}

async function manualDraft(overrides: Record<string, unknown> = {}) {
  return db.ticket.create({
    data: {
      channel: "SELF",
      isDraft: true,
      siteId,
      buildingId,
      apartmentId,
      createdById: manager.id,
      description: "אין חשמל",
      ...overrides,
    },
  });
}

/** מדמה תשובה במייל שמוזגה לטיוטה: כותב את מה שהמנוע החזיר */
async function mergeReply(
  ticketId: string,
  proposal: Parameters<typeof mergeEmailIntoDraft>[0]["proposal"],
  receivedAt = new Date(),
) {
  const state = await loadDraftState(ticketId);
  const merged = mergeEmailIntoDraft({ state, proposal, receivedAt, messageId: `m-${receivedAt.getTime()}` });
  const values = merged.state.values;
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      siteId: values.siteId,
      buildingId: values.buildingId,
      apartmentId: values.apartmentId,
      room: values.room,
      domainId: values.domainId,
      description: values.description,
      draftRecipients: values.recipients as never,
    },
  });
  for (const field of ["SITE", "BUILDING", "APARTMENT", "ROOM", "DOMAIN", "DESCRIPTION", "RECIPIENTS"] as const) {
    const meta = merged.state.meta[field];
    const data = {
      fromEmail: meta.fromEmail,
      systemEditedAt: meta.systemEditedAt,
      conflict: meta.conflict,
      emailValue: (meta.emailValue ?? undefined) as never,
      emailMessageId: null,
    };
    await db.draftField.upsert({
      where: { ticketId_field: { ticketId, field } },
      create: { ticketId, field, ...data },
      update: data,
    });
  }
  return merged;
}

describe("EM-C05 — עריכה במערכת: מה נכתב, ומה יורד", () => {
  it("שדה שמולא מהמייל ונערך במערכת מאבד את התג ונרשם כעריכה", async () => {
    const ticket = await emailDraft({ domainId });
    await db.draftField.create({ data: { ticketId: ticket.id, field: "DOMAIN", fromEmail: true } });

    await updateDraftFields(toViewer(admin), ticket.id, { domainId: otherDomainId });

    const row = await db.draftField.findUniqueOrThrow({
      where: { ticketId_field: { ticketId: ticket.id, field: "DOMAIN" } },
    });
    expect(row.fromEmail).toBe(false);
    expect(row.systemEditedAt).not.toBeNull();
    expect(row.conflict).toBe(false);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).domainId).toBe(otherDomainId);

    const events = await db.message.findMany({ where: { ticketId: ticket.id, kind: "EVENT" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventMeta).toMatchObject({ fields: he.directory.domain });
  });

  it("שמירה מפורשת של אותו ערך סוגרת סתירה פתוחה, בלי אירוע בשרשור", async () => {
    const ticket = await emailDraft({ domainId });
    await updateDraftFields(toViewer(admin), ticket.id, { domainId });
    await mergeReply(ticket.id, { domain: otherDomainId });
    expect((await loadDraftState(ticket.id)).meta.DOMAIN.conflict).toBe(true);

    await updateDraftFields(toViewer(admin), ticket.id, { domainId });

    const state = await loadDraftState(ticket.id);
    expect(state.meta.DOMAIN.conflict).toBe(false);
    expect(state.meta.DOMAIN.emailValue).toBeNull();
    expect(state.values.domainId).toBe(domainId);
    // אף אחת מהעריכות לא שינתה ערך (התחום נקבע כבר ביצירה), ולכן אין אירוע
    // בשרשור — "עודכנו: תחום" על שמירה שלא שינתה דבר הוא רעש בהיסטוריה
    const events = await db.message.findMany({ where: { ticketId: ticket.id, kind: "EVENT" } });
    expect(events).toHaveLength(0);
  });

  it("בטיוטה ידנית לא נוצרות שורות מטא כלל", async () => {
    const ticket = await manualDraft();
    await updateTicketFields(toViewer(manager), ticket.id, { domainId });

    expect(await db.draftField.count({ where: { ticketId: ticket.id } })).toBe(0);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).domainId).toBe(domainId);
  });
});

describe("EM-C10 — איפוס בשרת", () => {
  it("החלפת אתר מאפסת בניין ודירה, ומשאירה את הנמענים", async () => {
    const ticket = await manualDraft({
      draftRecipients: [{ kind: "professional", id: professionalId }] as never,
    });

    await updateTicketFields(toViewer(admin), ticket.id, { siteId: otherSiteId });

    const after = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.siteId).toBe(otherSiteId);
    expect(after.buildingId).toBeNull();
    expect(after.apartmentId).toBeNull();
    expect(activeRecipients(parseDraftRecipients(after.draftRecipients))).toHaveLength(1);
  });

  it("החלפת בניין מאפסת את הדירה", async () => {
    const ticket = await manualDraft();
    const newBuilding = await db.building.create({ data: { siteId, name: "בניין ג" } });

    await updateTicketFields(toViewer(manager), ticket.id, { buildingId: newBuilding.id });

    const after = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.buildingId).toBe(newBuilding.id);
    expect(after.apartmentId).toBeNull();
  });

  it("אתר ובניין באותה שמירה — הבניין החדש נשמר ואינו מתאפס", async () => {
    const ticket = await manualDraft();

    await updateTicketFields(toViewer(admin), ticket.id, {
      siteId: otherSiteId,
      buildingId: otherBuildingId,
    });

    const after = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.buildingId).toBe(otherBuildingId);
    expect(after.apartmentId).toBeNull();
  });

  it("בניין מאתר אחר בלי החלפת אתר — נדחה", async () => {
    const ticket = await manualDraft();
    await expect(
      updateTicketFields(toViewer(admin), ticket.id, { buildingId: otherBuildingId }),
    ).rejects.toThrow(he.directory.locationMismatch);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).buildingId).toBe(buildingId);
  });

  it("איפוס אינו נחשב עריכה של הבניין (§7 שורה 85) — מייל מאוחר ממלא אותו בשקט", async () => {
    const ticket = await emailDraft({ buildingId, apartmentId });
    await updateDraftFields(toViewer(admin), ticket.id, { siteId: otherSiteId });

    const rows = await db.draftField.findMany({ where: { ticketId: ticket.id } });
    const building = rows.find((r) => r.field === "BUILDING");
    expect(building?.systemEditedAt ?? null).toBeNull();

    await mergeReply(ticket.id, { building: otherBuildingId });
    const state = await loadDraftState(ticket.id);
    expect(state.values.buildingId).toBe(otherBuildingId);
    expect(state.meta.BUILDING.conflict).toBe(false);
    expect(state.meta.BUILDING.fromEmail).toBe(true);

    // החצי השני של אותה שורה: השינוי שנעשה במערכת נרשם בשרשור, כולל
    // השדות שהתאפסו בעקבותיו
    const events = await db.message.findMany({ where: { ticketId: ticket.id, kind: "EVENT" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventMeta).toMatchObject({
      fields: [he.ticket.site, he.directory.building, he.directory.apartment].join(", "),
    });
  });
});

describe("אתר ונמענים — הרשאה והיקף", () => {
  it("מנהל עבודה אינו מעביר טיוטה לאתר אחר", async () => {
    const ticket = await manualDraft();
    await expect(
      updateTicketFields(toViewer(manager), ticket.id, { siteId: otherSiteId }),
    ).rejects.toThrow(he.common.notAllowed);
  });

  it("מנהל עבודה מאתר אחר אינו עורך את הטיוטה בכלל", async () => {
    const ticket = await manualDraft();
    await expect(
      updateTicketFields(toViewer(otherManager), ticket.id, { domainId }),
    ).rejects.toThrow(he.common.notAllowed);
  });

  it("אתר ונמענים אינם נערכים בפנייה ששוגרה", async () => {
    const ticket = await db.ticket.create({
      data: { channel: "SELF", isDraft: false, siteId, buildingId, apartmentId, domainId, createdById: manager.id, description: "x" },
    });

    await expect(
      updateTicketFields(toViewer(admin), ticket.id, { siteId: otherSiteId }),
    ).rejects.toThrow(he.common.notAllowed);
    await expect(
      updateTicketFields(toViewer(admin), ticket.id, { recipients: [{ kind: "professional", id: professionalId }] }),
    ).rejects.toThrow(he.common.notAllowed);
  });

  it("נמענים נשמרים בטיוטה, ואיש מקצוע מושבת נדחה", async () => {
    const ticket = await manualDraft();

    await updateTicketFields(toViewer(manager), ticket.id, {
      recipients: [{ kind: "professional", id: professionalId }, { kind: "professional", id: professionalId }],
    });
    const saved = parseDraftRecipients(
      (await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).draftRecipients,
    );
    expect(saved).toEqual([{ kind: "professional", id: professionalId, origin: "SYSTEM", removedBySystemAt: null }]);

    await expect(
      updateTicketFields(toViewer(manager), ticket.id, {
        recipients: [{ kind: "professional", id: inactiveProfessionalId }],
      }),
    ).rejects.toThrow(/מושבת/);
  });

  it("EM-C08 — נמען שהוסר מטיוטת מייל נשאר כמצבה, ואינו נמען", async () => {
    const ticket = await emailDraft();
    await updateDraftFields(toViewer(admin), ticket.id, {
      recipients: [{ kind: "professional", id: professionalId }],
    });
    await updateDraftFields(toViewer(admin), ticket.id, { recipients: [] });

    const stored = parseDraftRecipients(
      (await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).draftRecipients,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.removedBySystemAt).not.toBeNull();
    expect(activeRecipients(stored)).toHaveLength(0);
  });
});

describe("EM-16 — שיגור", () => {
  async function ready(channel: "EMAIL" | "SELF" = "EMAIL") {
    return db.ticket.create({
      data: {
        channel,
        isDraft: true,
        siteId,
        buildingId,
        apartmentId,
        domainId,
        createdById: admin.id,
        description: "נזילה",
        draftRecipients: [{ kind: "professional", id: professionalId, origin: "EMAIL" }] as never,
      },
    });
  }

  it("סתירה פתוחה חוסמת את השיגור, בנוסח של מסך 7", async () => {
    const ticket = await ready();
    await updateDraftFields(toViewer(admin), ticket.id, { domainId });
    await mergeReply(ticket.id, { domain: otherDomainId });

    await expect(submitDraft(toViewer(admin), ticket.id)).rejects.toThrow(
      he.emailDraft.conflictBanner(1),
    );
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).isDraft).toBe(true);
    expect(await db.assignment.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("בלי רשימת נמענים — משגר את הנמענים השמורים בטיוטה", async () => {
    const ticket = await ready();

    await submitDraft(toViewer(admin), ticket.id);

    const after = await db.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { assignments: true },
    });
    expect(after.isDraft).toBe(false);
    expect(after.assignments.map((a) => a.professionalId)).toEqual([professionalId]);
    expect(after.draftRecipients).toBeNull();
  });

  it("נמען שהוסר במערכת אינו משוגר, גם כשהמצבה שלו נשמרה", async () => {
    const ticket = await ready();
    const second = await db.professional.create({ data: { name: "שני", phone: "0509999999" } });
    await updateDraftFields(toViewer(admin), ticket.id, {
      recipients: [{ kind: "professional", id: second.id }],
    });

    await submitDraft(toViewer(admin), ticket.id);

    const assignments = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    expect(assignments.map((a) => a.professionalId)).toEqual([second.id]);
  });

  /**
   * החלון האמיתי: הפנייה משתנה **אחרי** שהשיגור קרא אותה ולפני שהוא תפס את
   * הנעילה. בדיקה שמשנה את הפנייה לפני הקריאה ל-`submitDraft` עוברת גם על
   * המימוש הישן, ולכן אינה מוכיחה דבר — כאן מחזיקים נעילה מבחוץ, נותנים
   * לשיגור להיתקע עליה, ורק אז משנים ומשחררים.
   */
  async function whileSubmitWaitsForLock(
    ticketId: string,
    change: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<void>,
    submit: () => Promise<void>,
  ): Promise<{ submitted: Promise<void> }> {
    let letGo!: () => void;
    const gate = new Promise<void>((resolve) => {
      letGo = resolve;
    });

    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
        await gate;
        await change(tx);
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    // `submitDraft` קורא את הפנייה, ואז נתקע על הנעילה שמוחזקת למעלה
    const submitted = submit();
    await new Promise((resolve) => setTimeout(resolve, 300));
    letGo();
    await holder;
    return { submitted };
  }

  it("שדה חובה שהתרוקן בזמן שהשיגור המתין לנעילה עוצר אותו", async () => {
    const ticket = await ready();

    const { submitted } = await whileSubmitWaitsForLock(
      ticket.id,
      // מדמה תשובה במייל שהחליפה אתר ואיפסה בניין ודירה
      (tx) => tx.ticket.update({ where: { id: ticket.id }, data: { buildingId: null, apartmentId: null } }).then(),
      () => submitDraft(toViewer(admin), ticket.id),
    );

    await expect(submitted).rejects.toThrow(he.directory.building);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).isDraft).toBe(true);
  });

  it("נמען שנוסף בזמן שהשיגור המתין לנעילה אינו נעלם (§5.ב)", async () => {
    // בלי קריאה חוזרת של `draftRecipients` תחת הנעילה הוא לא קיבל שיוך,
    // והשדה התאפס בשיגור — כלומר גם הרשומה שלו נמחקה ואין ממנה דרך חזרה.
    const ticket = await ready();
    const second = await db.professional.create({ data: { name: "נוסף תוך כדי", phone: "0508888888" } });

    const { submitted } = await whileSubmitWaitsForLock(
      ticket.id,
      (tx) =>
        tx.ticket
          .update({
            where: { id: ticket.id },
            data: {
              draftRecipients: [
                { kind: "professional", id: professionalId, origin: "EMAIL" },
                { kind: "professional", id: second.id, origin: "EMAIL" },
              ] as never,
            },
          })
          .then(),
      () => submitDraft(toViewer(admin), ticket.id),
    );

    await submitted;
    const assignments = await db.assignment.findMany({ where: { ticketId: ticket.id } });
    expect(assignments.map((a) => a.professionalId).sort()).toEqual([professionalId, second.id].sort());
  });

  it("טיוטה ידנית אינה נחסמת בסתירות — אין לה מקור שני", async () => {
    const ticket = await ready("SELF");
    // שורת סתירה על טיוטה ידנית היא מצב שלא אמור להיווצר; אם היא קיימת,
    // החסימה עדיין אינה חלה — היא נגזרת מהערוץ. בלי השורה הזו הבדיקה הייתה
    // עוברת גם אם החסימה הייתה חלה על כל טיוטה.
    await db.draftField.create({ data: { ticketId: ticket.id, field: "DOMAIN", conflict: true } });

    await submitDraft(toViewer(admin), ticket.id, [{ kind: "professional", id: professionalId }]);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).isDraft).toBe(false);
  });
});

describe("EM-C09 — הכרעת סתירות (מסך 7א)", () => {
  async function conflicted() {
    const ticket = await emailDraft({ domainId });
    await updateDraftFields(toViewer(admin), ticket.id, { domainId });
    await mergeReply(ticket.id, { domain: otherDomainId });
    const state = await loadDraftState(ticket.id);
    return { ticket, version: conflictsVersion(state) };
  }

  it("בחירת 'מהמייל' כותבת את הערך, סוגרת את הסתירה, ונחשבת עריכה במערכת", async () => {
    const { ticket, version } = await conflicted();

    await resolveDraftConflicts(toViewer(admin), ticket.id, { DOMAIN: "email" }, version);

    const state = await loadDraftState(ticket.id);
    expect(state.values.domainId).toBe(otherDomainId);
    expect(state.meta.DOMAIN.conflict).toBe(false);
    expect(state.meta.DOMAIN.fromEmail).toBe(false);
    expect(state.meta.DOMAIN.systemEditedAt).not.toBeNull();
  });

  it("בחירת 'במערכת' שומרת את הערך וסוגרת את הסתירה", async () => {
    const { ticket, version } = await conflicted();

    await resolveDraftConflicts(toViewer(admin), ticket.id, { DOMAIN: "system" }, version);

    const state = await loadDraftState(ticket.id);
    expect(state.values.domainId).toBe(domainId);
    expect(state.meta.DOMAIN.conflict).toBe(false);
  });

  it("§7 שורה 84 — תשובה חדשה שהגיעה בינתיים דוחה את ההכרעה, ודבר אינו נכתב", async () => {
    const { ticket, version } = await conflicted();
    const third = await db.domain.create({ data: { name: "אלומיניום" } });
    await mergeReply(ticket.id, { domain: third.id }, new Date(Date.now() + 1000));

    await expect(
      resolveDraftConflicts(toViewer(admin), ticket.id, { DOMAIN: "email" }, version),
    ).rejects.toThrow(he.emailDraft.conflictsChanged);

    const state = await loadDraftState(ticket.id);
    expect(state.values.domainId).toBe(domainId);
    expect(state.meta.DOMAIN.conflict).toBe(true);
  });

  it("שדה בסתירה בלי בחירה — נדחה, כדי שלא ייסגר בשקט", async () => {
    const { ticket, version } = await conflicted();
    await expect(resolveDraftConflicts(toViewer(admin), ticket.id, {}, version)).rejects.toThrow(
      he.common.notAllowed,
    );
  });

  it("מנהל עבודה אינו מכריע אתר לצד המייל כשהוא מוציא את הטיוטה מהאתר שלו", async () => {
    const ticket = await emailDraft({ buildingId, apartmentId });
    await updateDraftFields(toViewer(manager), ticket.id, { domainId });
    await mergeReply(ticket.id, { site: otherSiteId });
    // המייל הציע אתר אחר לשדה שלא נערך — הוא נכנס בשקט, ולכן כאן קודם עורכים
    // את האתר במערכת, וכך התשובה הבאה תיצור סתירה אמיתית
    await db.ticket.update({ where: { id: ticket.id }, data: { siteId } });
    await db.draftField.upsert({
      where: { ticketId_field: { ticketId: ticket.id, field: "SITE" } },
      create: { ticketId: ticket.id, field: "SITE", systemEditedAt: new Date(Date.now() - 60_000) },
      update: { systemEditedAt: new Date(Date.now() - 60_000), fromEmail: false, conflict: false },
    });
    await mergeReply(ticket.id, { site: otherSiteId });
    const version = conflictsVersion(await loadDraftState(ticket.id));

    await expect(
      resolveDraftConflicts(toViewer(manager), ticket.id, { SITE: "email" }, version),
    ).rejects.toThrow(he.common.notAllowed);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).siteId).toBe(siteId);
  });

  it("סתירה שהערך מהמייל בה פגום — ההכרעה אינה ממציאה ערך, ועריכה ישירה סוגרת אותה", async () => {
    const ticket = await emailDraft({ domainId });
    await db.draftField.create({
      data: { ticketId: ticket.id, field: "DOMAIN", conflict: true, emailValue: { field: "DOMAIN" }, systemEditedAt: new Date() },
    });
    const version = conflictsVersion(await loadDraftState(ticket.id));

    await resolveDraftConflicts(toViewer(admin), ticket.id, { DOMAIN: "email" }, version);
    const stuck = await loadDraftState(ticket.id);
    expect(stuck.values.domainId).toBe(domainId);
    expect(stuck.meta.DOMAIN.conflict).toBe(true);

    // הדרך החוצה קיימת: עריכה ישירה של השדה (§3.5, "נערך במערכת אחרי המייל")
    await updateDraftFields(toViewer(admin), ticket.id, { domainId: otherDomainId });
    expect((await loadDraftState(ticket.id)).meta.DOMAIN.conflict).toBe(false);
  });

  it("טיוטה ידנית אינה עוברת בחלון הסתירות", async () => {
    const ticket = await manualDraft();
    await expect(resolveDraftConflicts(toViewer(admin), ticket.id, {}, "[]")).rejects.toThrow(
      he.common.notAllowed,
    );
  });
});

describe("EM-S7-05 — הסרת מדיה מטיוטת מייל", () => {
  async function withMedia() {
    const ticket = await emailDraft();
    const message = await db.message.create({
      data: { ticketId: ticket.id, kind: "MEDIA", authorUserId: admin.id },
    });
    const media = await db.mediaFile.create({
      data: {
        messageId: message.id,
        storageKey: `mail/${ticket.id}/logo.png`,
        mimeType: "image/png",
        sizeBytes: 100,
        uploaded: true,
        extractedText: "לוגו החברה",
      },
    });
    const mailMessage = await db.mailboxMessage.create({
      data: { direction: "INBOUND", state: "DONE", gmailThreadId: "t1", rfcMessageId: "<a@x>" },
    });
    const attachment = await db.mailboxAttachment.create({
      data: {
        messageId: mailMessage.id,
        partIndex: 1,
        mimeType: "image/png",
        sizeBytes: 100,
        isMedia: true,
        inline: true,
        sha256: "abc",
        mediaFileId: media.id,
      },
    });
    return { ticket, message, media, attachment };
  }

  it("הקובץ יורד מהטיוטה, נשאר בהתכתבות, וההודעה הריקה נמחקת", async () => {
    const { ticket, message, media, attachment } = await withMedia();

    await removeDraftMedia(toViewer(admin), media.id);

    expect(await db.mediaFile.findUnique({ where: { id: media.id } })).toBeNull();
    expect(await db.message.findUnique({ where: { id: message.id } })).toBeNull();
    const after = await db.mailboxAttachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(after.removedFromDraftAt).not.toBeNull();
    expect(after.mediaFileId).toBeNull();
    expect(after.sha256).toBe("abc");
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).isDraft).toBe(true);
  });

  it("הודעה עם טקסט או עם קובץ נוסף נשארת", async () => {
    const { message, media } = await withMedia();
    const second = await db.mediaFile.create({
      data: {
        messageId: message.id,
        storageKey: "mail/second.png",
        mimeType: "image/png",
        sizeBytes: 10,
        uploaded: true,
      },
    });

    await removeDraftMedia(toViewer(admin), media.id);

    expect(await db.message.findUnique({ where: { id: message.id } })).not.toBeNull();
    expect(await db.mediaFile.findUnique({ where: { id: second.id } })).not.toBeNull();
  });

  it("בטיוטה ידנית אין הסרה — מי שצירף קובץ בעצמו לא קיבל לוגו של חתימה", async () => {
    const manual = await manualDraft();
    const message = await db.message.create({
      data: { ticketId: manual.id, kind: "MEDIA", authorUserId: manager.id },
    });
    const media = await db.mediaFile.create({
      data: { messageId: message.id, storageKey: "k1", mimeType: "image/png", sizeBytes: 1, uploaded: true },
    });

    await expect(removeDraftMedia(toViewer(admin), media.id)).rejects.toThrow(he.common.notAllowed);
    expect(await db.mediaFile.findUnique({ where: { id: media.id } })).not.toBeNull();
  });

  it("אחרי השיגור המדיה חוזרת לכלל 'הוספה בלבד' (§3.2), גם בפנייה ממייל", async () => {
    const sent = await db.ticket.create({
      data: {
        channel: "EMAIL",
        isDraft: false,
        siteId,
        buildingId,
        apartmentId,
        domainId,
        createdById: admin.id,
        description: "שוגרה",
      },
    });
    const message = await db.message.create({
      data: { ticketId: sent.id, kind: "MEDIA", authorUserId: admin.id },
    });
    const media = await db.mediaFile.create({
      data: { messageId: message.id, storageKey: "k2", mimeType: "image/png", sizeBytes: 1, uploaded: true },
    });

    await expect(removeDraftMedia(toViewer(admin), media.id)).rejects.toThrow(he.common.notAllowed);
    expect(await db.mediaFile.findUnique({ where: { id: media.id } })).not.toBeNull();
  });

  it("מי שאינו רשאי לערוך את הטיוטה אינו מסיר ממנה קובץ", async () => {
    const { media } = await withMedia();
    await expect(removeDraftMedia(toViewer(otherManager), media.id)).rejects.toThrow(
      he.common.notAllowed,
    );
  });
});

describe("toDraftState מול המסד", () => {
  it("טיוטה בלי שורות מטא נקראת כמצב נקי, ואחרי עריכה יש לה שורה אחת בדיוק", async () => {
    const ticket = await emailDraft();
    const before = toDraftState(ticket, []);
    expect(before.meta.DOMAIN.systemEditedAt).toBeNull();

    const edited = applySystemEdit(before, { field: "DOMAIN", domainId }, new Date());
    expect(edited.meta.DOMAIN.systemEditedAt).not.toBeNull();

    await updateDraftFields(toViewer(admin), ticket.id, { domainId });
    expect(await db.draftField.count({ where: { ticketId: ticket.id } })).toBe(1);
  });
});
