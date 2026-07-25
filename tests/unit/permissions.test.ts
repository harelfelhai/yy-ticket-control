import { describe, expect, it } from "vitest";
import {
  type AssignmentAccessView,
  type TicketAccessView,
  type Viewer,
  canCloseTicket,
  canCommentOnTicket,
  canCreateTicketInSite,
  canDeleteDraft,
  canDeleteTicket,
  canEditAssignments,
  canEditTicketFields,
  canManageTagAccess,
  canPostTagChat,
  canReopenTicket,
  canSetHandler,
  canTagTicket,
  canViewTagChat,
  canViewTagTickets,
  canViewTicket,
  hasActiveAssignment,
} from "@/lib/permissions";

const SITE_A = "site-a";
const SITE_B = "site-b";

const admin: Viewer = { kind: "user", id: "u-admin", role: "ADMIN", siteId: null };
const owner: Viewer = { kind: "user", id: "u-owner", role: "OWNER", siteId: null };
const managerA: Viewer = { kind: "user", id: "u-mgr-a", role: "SITE_MANAGER", siteId: SITE_A };
const managerA2: Viewer = { kind: "user", id: "u-mgr-a2", role: "SITE_MANAGER", siteId: SITE_A };
const managerB: Viewer = { kind: "user", id: "u-mgr-b", role: "SITE_MANAGER", siteId: SITE_B };
const contractor: Viewer = { kind: "professional", id: "p-1" };
const otherContractor: Viewer = { kind: "professional", id: "p-2" };

function ticket(overrides: Partial<TicketAccessView> = {}): TicketAccessView {
  return { siteId: SITE_A, createdById: managerA.id, closedAt: null, ...overrides };
}

function assignedTo(viewer: Viewer, status: AssignmentAccessView["status"] = "SENT") {
  return viewer.kind === "professional"
    ? { professionalId: viewer.id, userId: null, status }
    : { professionalId: null, userId: viewer.id, status };
}

describe("canViewTicket", () => {
  it("מנהל מערכת רואה כל פנייה בכל אתר", () => {
    expect(canViewTicket(admin, ticket({ siteId: SITE_B }))).toBe(true);
  });

  it("בעלים רואה כל פנייה בכל אתר", () => {
    expect(canViewTicket(owner, ticket({ siteId: SITE_B }))).toBe(true);
  });

  it("מנהל עבודה רואה את כל הפניות באתר שלו, גם כאלה שלא פתח", () => {
    expect(canViewTicket(managerA2, ticket({ createdById: managerA.id }))).toBe(true);
  });

  it("מנהל עבודה אינו רואה פניות מאתר אחר", () => {
    expect(canViewTicket(managerB, ticket({ siteId: SITE_A }))).toBe(false);
  });

  it("מנהל עבודה בלי אתר משויך אינו רואה דבר", () => {
    const orphan: Viewer = { kind: "user", id: "u-x", role: "SITE_MANAGER", siteId: null };
    expect(canViewTicket(orphan, ticket())).toBe(false);
  });

  it("נמען רואה רק פנייה ששויכה אליו", () => {
    expect(canViewTicket(contractor, ticket(), [assignedTo(contractor)])).toBe(true);
    expect(canViewTicket(otherContractor, ticket(), [assignedTo(contractor)])).toBe(false);
  });

  it("נמען שהוסר מאבד גישה מיידית, גם עם קישור תקף", () => {
    // זה הכלל שמאפשר קישורי קסם ללא תפוגה: ההרשאה נבדקת דינמית בכל בקשה.
    expect(canViewTicket(contractor, ticket(), [assignedTo(contractor, "REMOVED")])).toBe(false);
  });

  it("נמען רואה פנייה משויכת גם באתר שאינו 'שלו' — לנמענים אין אתר", () => {
    const t = ticket({ siteId: SITE_B });
    expect(canViewTicket(contractor, t, [assignedTo(contractor)])).toBe(true);
  });

  it("נמען בלי שיוכים כלל אינו רואה דבר", () => {
    expect(canViewTicket(contractor, ticket(), [])).toBe(false);
  });
});

describe("hasActiveAssignment", () => {
  it.each(["SENT", "VIEWED", "DONE", "QUESTION"] as const)("%s נחשב שיוך פעיל", (status) => {
    expect(hasActiveAssignment(contractor, [assignedTo(contractor, status)])).toBe(true);
  });

  it("REMOVED אינו שיוך פעיל", () => {
    expect(hasActiveAssignment(contractor, [assignedTo(contractor, "REMOVED")])).toBe(false);
  });

  it("מזהה נמען פנימי לפי userId ולא לפי professionalId", () => {
    // תזכורן: מנהל משייך פנייה לעצמו. אסור שהשוואת המזהים תתבלבל בין הסוגים.
    expect(hasActiveAssignment(managerA, [assignedTo(managerA)])).toBe(true);
    expect(hasActiveAssignment(managerA, [assignedTo(contractor)])).toBe(false);
  });
});

describe("canCreateTicketInSite", () => {
  it("מנהל מערכת ובעלים פותחים פניות בכל אתר", () => {
    expect(canCreateTicketInSite(admin, SITE_B)).toBe(true);
    expect(canCreateTicketInSite(owner, SITE_B)).toBe(true);
  });

  it("מנהל עבודה פותח רק באתר שלו", () => {
    expect(canCreateTicketInSite(managerA, SITE_A)).toBe(true);
    expect(canCreateTicketInSite(managerA, SITE_B)).toBe(false);
  });

  it("נמען אינו פותח פניות — הוא מקבל אותן", () => {
    expect(canCreateTicketInSite(contractor, SITE_A)).toBe(false);
  });
});

describe("canCloseTicket — הסגירה היא שיקול דעת אנושי", () => {
  it("מנהל מערכת סוגר כל פנייה", () => {
    expect(canCloseTicket(admin, ticket({ createdById: managerA.id }))).toBe(true);
  });

  it("הפותח סוגר את הפנייה שפתח", () => {
    expect(canCloseTicket(managerA, ticket({ createdById: managerA.id }))).toBe(true);
  });

  it("מנהל עבודה אחר באותו אתר אינו סוגר פנייה שלא פתח", () => {
    expect(canCloseTicket(managerA2, ticket({ createdById: managerA.id }))).toBe(false);
  });

  it("בעלים אינו סוגר פנייה שלא פתח", () => {
    expect(canCloseTicket(owner, ticket({ createdById: managerA.id }))).toBe(false);
  });

  it("בעלים סוגר פנייה שהוא עצמו פתח", () => {
    expect(canCloseTicket(owner, ticket({ createdById: owner.id }))).toBe(true);
  });

  it("נמען לעולם אינו סוגר — גם אם סימן טופל", () => {
    expect(canCloseTicket(contractor, ticket())).toBe(false);
  });

  it("פתיחה מחדש שמורה לאותם אנשים כמו הסגירה", () => {
    const closed = ticket({ closedAt: new Date() });
    expect(canReopenTicket(managerA, closed)).toBe(canCloseTicket(managerA, closed));
    expect(canReopenTicket(managerA2, closed)).toBe(false);
    expect(canReopenTicket(contractor, closed)).toBe(false);
  });
});

describe("canDeleteTicket — רק כפילות ותקלה", () => {
  it("מנהל מערכת בלבד", () => {
    expect(canDeleteTicket(admin)).toBe(true);
    expect(canDeleteTicket(owner)).toBe(false);
    expect(canDeleteTicket(managerA)).toBe(false);
    expect(canDeleteTicket(contractor)).toBe(false);
  });

  it("גם הפותח עצמו אינו מוחק פנייה שפתח", () => {
    // פנייה אמיתית אינה נמחקת. מחיקה היא פעולה של מנהל מערכת בלבד.
    expect(canDeleteTicket(managerA)).toBe(false);
  });
});

describe("canEditAssignments", () => {
  it("מנהל מערכת עורך נמענים בכל אתר", () => {
    expect(canEditAssignments(admin, ticket({ siteId: SITE_B }))).toBe(true);
  });

  it("מנהל עבודה עורך נמענים בכל פנייה באתר שלו", () => {
    expect(canEditAssignments(managerA2, ticket({ createdById: managerA.id }))).toBe(true);
  });

  it("מנהל עבודה אינו עורך נמענים באתר אחר", () => {
    expect(canEditAssignments(managerB, ticket({ siteId: SITE_A }))).toBe(false);
  });

  it("בעלים עורך נמענים רק בפנייה שהוא פתח", () => {
    expect(canEditAssignments(owner, ticket({ createdById: owner.id }))).toBe(true);
    expect(canEditAssignments(owner, ticket({ createdById: managerA.id }))).toBe(false);
  });

  it("נמען אינו עורך נמענים", () => {
    expect(canEditAssignments(contractor, ticket())).toBe(false);
  });
});

describe("canEditTicketFields — אותה קבוצה כמו עריכת נמענים", () => {
  it("מנהל מערכת, מנהל האתר והפותח רשאים; בעלים-לא-פותח ונמען לא", () => {
    const t = ticket({ createdById: managerA.id });
    expect(canEditTicketFields(admin, ticket({ siteId: SITE_B }))).toBe(true);
    expect(canEditTicketFields(managerA2, t)).toBe(true); // מנהל אחר באתר
    expect(canEditTicketFields(managerB, ticket({ siteId: SITE_A }))).toBe(false); // אתר אחר
    expect(canEditTicketFields(owner, ticket({ createdById: owner.id }))).toBe(true); // בעלים שפתח
    expect(canEditTicketFields(owner, t)).toBe(false); // בעלים שלא פתח
    expect(canEditTicketFields(contractor, t)).toBe(false); // נמען
  });
});

describe("canDeleteDraft — טיוטה בלבד, לקבוצה שמנהלת את הפנייה", () => {
  const draft = (o: Partial<TicketAccessView> = {}) => ({ ...ticket(o), isDraft: true });
  const live = (o: Partial<TicketAccessView> = {}) => ({ ...ticket(o), isDraft: false });

  it("פותח, מנהל האתר ומנהל מערכת מוחקים טיוטה", () => {
    expect(canDeleteDraft(managerA, draft({ createdById: managerA.id }))).toBe(true);
    expect(canDeleteDraft(managerA2, draft({ createdById: managerA.id }))).toBe(true);
    expect(canDeleteDraft(admin, draft({ siteId: SITE_B }))).toBe(true);
  });

  it("בעלים שלא פתח ונמען אינם מוחקים טיוטה", () => {
    expect(canDeleteDraft(owner, draft({ createdById: managerA.id }))).toBe(false);
    expect(canDeleteDraft(contractor, draft())).toBe(false);
  });

  it("פנייה שאינה טיוטה אינה נמחקת במסלול הזה — גם לא בידי הפותח", () => {
    // הכלל "פנייה אמיתית אינה נמחקת" נשמר: המסלול הזה חוסם על isDraft.
    expect(canDeleteDraft(managerA, live({ createdById: managerA.id }))).toBe(false);
    expect(canDeleteDraft(admin, live())).toBe(false);
  });
});

describe("canCommentOnTicket", () => {
  it("נמען משויך מגיב בפנייה פתוחה", () => {
    expect(canCommentOnTicket(contractor, ticket(), [assignedTo(contractor)])).toBe(true);
  });

  it("נמען אינו מגיב בפנייה סגורה", () => {
    const closed = ticket({ closedAt: new Date() });
    expect(canCommentOnTicket(contractor, closed, [assignedTo(contractor)])).toBe(false);
  });

  it("נמען שהוסר אינו מגיב", () => {
    expect(canCommentOnTicket(contractor, ticket(), [assignedTo(contractor, "REMOVED")])).toBe(
      false,
    );
  });

  it("משתמש פנימי מגיב גם בפנייה סגורה — הוא זה שיכול לפתוח אותה מחדש", () => {
    const closed = ticket({ closedAt: new Date() });
    expect(canCommentOnTicket(managerA, closed)).toBe(true);
  });

  it("מנהל עבודה מאתר אחר אינו מגיב", () => {
    expect(canCommentOnTicket(managerB, ticket({ siteId: SITE_A }))).toBe(false);
  });
});

describe("canSetHandler — סימון פנימי בלבד", () => {
  it("מנהל עבודה באתר שלו רשאי", () => {
    expect(canSetHandler(managerA2, ticket())).toBe(true);
  });

  it("נמען אינו רשאי, גם כשהוא משויך", () => {
    expect(canSetHandler(contractor, ticket(), [assignedTo(contractor)])).toBe(false);
  });

  it("מנהל עבודה מאתר אחר אינו רשאי", () => {
    expect(canSetHandler(managerB, ticket({ siteId: SITE_A }))).toBe(false);
  });
});

describe("תגיות — הפתיחה חושפת צ׳אט ולא פניות", () => {
  it("נמען רואה את הצ׳אט רק אם התגית נפתחה לו במפורש", () => {
    expect(canViewTagChat(contractor, [contractor.id])).toBe(true);
    expect(canViewTagChat(otherContractor, [contractor.id])).toBe(false);
  });

  it("תגית ללא פתיחה סגורה בפני כל נמען", () => {
    expect(canViewTagChat(contractor, [])).toBe(false);
  });

  it("משתמשים פנימיים רואים כל צ׳אט תגית", () => {
    expect(canViewTagChat(managerB, [])).toBe(true);
    expect(canViewTagChat(owner, [])).toBe(true);
  });

  it("נמען לעולם אינו רואה את רשימת הפניות של התגית — גם כשנפתחה לו", () => {
    // הנקודה הרגישה במודל: 30 ליקויי בדק בית בתגית אחת, והקבלן משויך לאחד.
    expect(canViewTagTickets(contractor)).toBe(false);
  });

  it("משתמש פנימי רואה את רשימת הפניות של התגית", () => {
    expect(canViewTagTickets(managerA)).toBe(true);
  });

  it("כתיבה בצ׳אט זהה לצפייה בו", () => {
    expect(canPostTagChat(contractor, [contractor.id])).toBe(true);
    expect(canPostTagChat(otherContractor, [contractor.id])).toBe(false);
    expect(canPostTagChat(managerA, [])).toBe(true);
  });

  it("תיוג פנייה מותר לפותח ולכל מנהל, זהה לעריכת נמענים", () => {
    // אצילה ל-canEditAssignments: אותה קבוצת מורשים, מקור אמת אחד.
    const t = ticket({ createdById: managerA.id });
    expect(canTagTicket(admin, t)).toBe(canEditAssignments(admin, t));
    expect(canTagTicket(managerA2, t)).toBe(true); // מנהל אחר באתר
    expect(canTagTicket(managerB, ticket({ siteId: SITE_A }))).toBe(false); // אתר אחר
    expect(canTagTicket(owner, ticket({ createdById: owner.id }))).toBe(true); // בעלים שפתח
    expect(canTagTicket(contractor, t)).toBe(false); // נמען לא מתייג
  });

  it("פתיחת תגית לקבלנים שמורה למנהל מערכת ולמנהל עבודה בלבד", () => {
    // בעלים תפקידו צפייה ופתיחת פניות, לא תיאום קבלנים סביב קבוצת ליקויים.
    expect(canManageTagAccess(admin)).toBe(true);
    expect(canManageTagAccess(managerA)).toBe(true);
    expect(canManageTagAccess(owner)).toBe(false);
    expect(canManageTagAccess(contractor)).toBe(false);
  });
});
