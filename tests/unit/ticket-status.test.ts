import { describe, expect, it } from "vitest";
import { he } from "@/lib/he";
import {
  type AssignmentView,
  type TicketView,
  activeAssignments,
  daysWithoutActivity,
  deriveAwaitingReply,
  deriveBoardSection,
  deriveTicketStatus,
  isStale,
  reasonText,
  toLastMessageView,
} from "@/lib/ticket-status";

const NOW = new Date("2026-03-15T09:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function ticket(overrides: Partial<TicketView> = {}): TicketView {
  return {
    isDraft: false,
    closedAt: null,
    escalated: false,
    lastActivityAt: NOW,
    handlerName: null,
    ...overrides,
  };
}

function to(status: AssignmentView["status"], recipientName = "נמען"): AssignmentView {
  return { status, recipientName };
}

describe("deriveTicketStatus — טבלת העדיפויות של §3.5", () => {
  it("שורה 1: פנייה סגורה היא סגורה, גם אם נמען כתב בה אחרון", () => {
    const closed = ticket({ closedAt: NOW, awaitingReply: { recipientName: "יוסי" } });
    expect(deriveTicketStatus(closed, [to("VIEWED")])).toBe("CLOSED");
  });

  it("שורה 1 גוברת גם על טיוטה", () => {
    expect(deriveTicketStatus(ticket({ closedAt: NOW, isDraft: true }), [])).toBe("CLOSED");
  });

  it("שורה 2: טיוטה, כל עוד לא נסגרה", () => {
    expect(deriveTicketStatus(ticket({ isDraft: true }), [])).toBe("DRAFT");
  });

  it("שורה 3: כל הנמענים סימנו טופל", () => {
    expect(deriveTicketStatus(ticket(), [to("DONE"), to("DONE")])).toBe(
      "AWAITING_OPENER_APPROVAL",
    );
  });

  it("שורה 4: חלק סימנו טופל", () => {
    expect(deriveTicketStatus(ticket(), [to("DONE"), to("VIEWED"), to("SENT")])).toBe("PARTIAL");
  });

  it("שורה 5: מישהו צפה ואיש לא הגיב", () => {
    expect(deriveTicketStatus(ticket(), [to("VIEWED"), to("SENT")])).toBe("VIEWED");
  });

  it("שורה 6: אף אחד לא צפה", () => {
    expect(deriveTicketStatus(ticket(), [to("SENT"), to("SENT")])).toBe("NEW");
  });
});

describe("deriveTicketStatus — מקרי קצה", () => {
  it("פנייה בלי שיוכים כלל היא חדשה, ולא נעלמת ולא נסגרת מעצמה", () => {
    expect(deriveTicketStatus(ticket(), [])).toBe("NEW");
  });

  it("פנייה שכל נמעניה הוסרו חוזרת להיות חדשה וממתינה לשיוך", () => {
    expect(deriveTicketStatus(ticket(), [to("REMOVED"), to("REMOVED")])).toBe("NEW");
  });

  it("שיוך שהוסר אינו נספר בחישוב 'כולם סיימו'", () => {
    // בלי סינון ההוסרים, שיוך REMOVED היה מונע 'כולם סיימו' לנצח.
    expect(deriveTicketStatus(ticket(), [to("DONE"), to("REMOVED")])).toBe(
      "AWAITING_OPENER_APPROVAL",
    );
  });

  it("שיוך שהוסר אינו משפיע על הגזירה", () => {
    expect(deriveTicketStatus(ticket(), [to("REMOVED"), to("SENT")])).toBe("NEW");
  });

  it("נמען יחיד שסיים מעביר את הפנייה לאישור ולא לטיפול חלקי", () => {
    expect(deriveTicketStatus(ticket(), [to("DONE")])).toBe("AWAITING_OPENER_APPROVAL");
  });

  /**
   * ‏"שאלה" ירדה מטבלת הסטטוסים ב-0.4 והפכה לדגל סקציה.
   *
   * זו הטענה ששומרת על ההפרדה: קבלן שסימן טופל ואז חזר עם שאלה **עדיין**
   * סיים את עבודתו, והסטטוס ממשיך לומר זאת. מה שמשתנה הוא היכן הפנייה
   * יושבת בלוח — וזו שאלה אחרת לגמרי (ראה deriveBoardSection).
   */
  it("הודעה מנמען אינה משנה את סטטוס הפנייה", () => {
    const waiting = ticket({ awaitingReply: { recipientName: "יוסי" } });
    expect(deriveTicketStatus(waiting, [to("DONE", "יוסי")])).toBe("AWAITING_OPENER_APPROVAL");
    expect(deriveTicketStatus(waiting, [to("VIEWED", "יוסי")])).toBe("VIEWED");
  });

  it("פתיחה מחדש מחזירה את כולם ל'נשלח' והפנייה חוזרת להיות חדשה", () => {
    // "נפתח מחדש" אינו סטטוס נפרד (§3.5) — הפנייה חוזרת להתנהג לפי הכללים.
    expect(deriveTicketStatus(ticket({ closedAt: null }), [to("SENT"), to("SENT")])).toBe("NEW");
  });
});

describe("activeAssignments", () => {
  it("מסנן רק שיוכים שהוסרו", () => {
    const all = [to("SENT"), to("REMOVED"), to("DONE"), to("VIEWED")];
    expect(activeAssignments(all).map((a) => a.status)).toEqual(["SENT", "DONE", "VIEWED"]);
  });
});

describe("deriveBoardSection — אצל מי הכדור", () => {
  it("סגור הולך לארכיון", () => {
    expect(deriveBoardSection("CLOSED", false)).toBe("ARCHIVE");
  });

  it("סגור נשאר בארכיון גם אם סומן כמוסלם", () => {
    expect(deriveBoardSection("CLOSED", true)).toBe("ARCHIVE");
  });

  it.each(["DRAFT", "AWAITING_OPENER_APPROVAL"] as const)("%s דורש פעולה מהצוות", (status) => {
    expect(deriveBoardSection(status, false)).toBe("ACTION_REQUIRED");
  });

  it.each(["PARTIAL", "VIEWED", "NEW"] as const)("%s נשאר אצל הנמענים", (status) => {
    expect(deriveBoardSection(status, false)).toBe("WITH_RECIPIENTS");
  });

  it.each(["PARTIAL", "VIEWED", "NEW"] as const)(
    "%s עובר ל'דורש ממך' כשהוא מוסלם",
    (status) => {
      expect(deriveBoardSection(status, true)).toBe("ACTION_REQUIRED");
    },
  );

  /**
   * הודעה שממתינה למענה, הדגל שהחליף את "יש לי שאלה".
   *
   * בלעדיו קבלן היה כותב "צריך מפתח לחדר החשמל", והפנייה הייתה נשארת
   * ב"אצל הנמענים" — המקום שמנהל אינו סורק, כי לכאורה מישהו אחר מטפל בה.
   */
  it.each(["PARTIAL", "VIEWED", "NEW"] as const)(
    "%s עובר ל'דורש ממך' כשהודעה ממתינה למענה",
    (status) => {
      expect(deriveBoardSection(status, false, true)).toBe("ACTION_REQUIRED");
    },
  );

  it("פנייה סגורה נשארת בארכיון גם כשההודעה האחרונה מנמען", () => {
    // סגירה גוברת על הכול. פנייה סגורה שקופצת חזרה ללוח היא בדיוק
    // ההתנהגות ששוחקת את האמון במיון.
    expect(deriveBoardSection("CLOSED", false, true)).toBe("ARCHIVE");
  });
});

describe("היעדר תנועה", () => {
  it("סופר ימים שלמים בלבד", () => {
    expect(daysWithoutActivity(ticket({ lastActivityAt: daysAgo(9) }), NOW)).toBe(9);
  });

  it("6 ימים עדיין לא חוצים את הסף", () => {
    expect(isStale(ticket({ lastActivityAt: daysAgo(6) }), NOW)).toBe(false);
  });

  it("7 ימים חוצים את הסף", () => {
    expect(isStale(ticket({ lastActivityAt: daysAgo(7) }), NOW)).toBe(true);
  });

  it("פנייה סגורה לעולם אינה מוסלמת", () => {
    expect(isStale(ticket({ lastActivityAt: daysAgo(30), closedAt: NOW }), NOW)).toBe(false);
  });

  it("טיוטה אינה מוסלמת — היא ממילא כבר ב'דורש ממך'", () => {
    expect(isStale(ticket({ lastActivityAt: daysAgo(30), isDraft: true }), NOW)).toBe(false);
  });
});

/**
 * מי "מחזיק את הכדור" לפי ההודעה האחרונה בשרשור.
 *
 * הפונקציה הזו החליפה את סטטוס `QUESTION`: אין עוד כפתור "יש לי שאלה",
 * ולכן שאלה של קבלן מגיעה כהודעה רגילה — ומה שמסמן אותה למנהל הוא העובדה
 * שהכותב האחרון הוא נמען שאיש לא ענה לו.
 */
describe("deriveAwaitingReply — האם ההודעה האחרונה ממתינה למענה", () => {
  const contractor = { authorUserId: null, authorProfessionalId: "p1", authorName: "יוסי" };

  it("הודעה מנמען פעיל ממתינה למענה", () => {
    expect(deriveAwaitingReply(contractor, ["p1"])).toEqual({ recipientName: "יוסי" });
  });

  it("פנייה בלי שרשור אינה ממתינה לדבר", () => {
    expect(deriveAwaitingReply(null, ["p1"])).toBeNull();
  });

  it("אירוע מערכת אינו הודעה של אדם", () => {
    // "שויך לרונית" נכתב בידי המערכת. בלי התנאי הזה כל שיוך היה מסמן את
    // הפנייה כממתינה למענה, וכל פנייה חדשה הייתה נוחתת ב"דורש ממך".
    const event = { authorUserId: null, authorProfessionalId: null, authorName: "" };
    expect(deriveAwaitingReply(event, ["p1"])).toBeNull();
  });

  it("מנהל שכתב אחרון אינו ממתין לעצמו", () => {
    const manager = { authorUserId: "u9", authorProfessionalId: null, authorName: "דוד" };
    expect(deriveAwaitingReply(manager, ["p1"])).toBeNull();
  });

  it("נמען שהוסר אחרי שכתב אינו מחזיק את הכדור", () => {
    // הוא כבר לא בתמונה, ואין למי לענות.
    expect(deriveAwaitingReply(contractor, [])).toBeNull();
  });

  it("נמען פנימי נספר כנמען לכל דבר", () => {
    // עובד חברה שמשויך לפנייה הוא נמען, לא "צוות" — §5.ז מקנה לו את אותן
    // פעולות בדיוק, והשאלה היחידה היא אם יש לו שיוך פעיל.
    const internal = { authorUserId: "u5", authorProfessionalId: null, authorName: "רונית" };
    expect(deriveAwaitingReply(internal, ["u5"])).toEqual({ recipientName: "רונית" });
  });

  it("המענה מנקה את הדגל בלי שדה שמור", () => {
    // ברגע שמנהל כותב, ההודעה האחרונה היא שלו — והדגל נופל מעצמו. אין
    // "סימון כנקרא" שמישהו צריך לזכור לבצע.
    const managerReplied = { authorUserId: "u9", authorProfessionalId: null, authorName: "דוד" };
    expect(deriveAwaitingReply(contractor, ["p1"])).not.toBeNull();
    expect(deriveAwaitingReply(managerReplied, ["p1"])).toBeNull();
  });
});

describe("toLastMessageView — מהשאילתה לגזירה", () => {
  it("מערך ריק הוא 'אין הודעה', ולא קריסה", () => {
    // שלושת הקוראים שולפים take:1. הפונקציה מקבלת מערך בדיוק כדי שאיש
    // מהם לא יכתוב messages[0] בעצמו וישכח את המקרה הריק.
    expect(toLastMessageView([])).toBeNull();
  });

  it("שולף את שם הכותב משני סוגי הכותבים", () => {
    const fromPro = toLastMessageView([
      {
        authorUserId: null,
        authorProfessionalId: "p1",
        authorUser: null,
        authorProfessional: { name: "יוסי" },
      },
    ]);
    expect(fromPro).toEqual({
      authorUserId: null,
      authorProfessionalId: "p1",
      authorName: "יוסי",
    });

    const fromUser = toLastMessageView([
      {
        authorUserId: "u1",
        authorProfessionalId: null,
        authorUser: { name: "דוד" },
        authorProfessional: null,
      },
    ]);
    expect(fromUser?.authorName).toBe("דוד");
  });
});

describe("reasonText — למה הפנייה נמצאת כאן", () => {
  it("טיפול חלקי מציג את היחס בדיוק כמו באפיון", () => {
    const text = reasonText(ticket(), [to("DONE"), to("DONE"), to("SENT")], NOW);
    expect(text).toBe("2 מתוך 3 סיימו");
  });

  it("היחס מתעלם משיוכים שהוסרו", () => {
    const text = reasonText(ticket(), [to("DONE"), to("SENT"), to("REMOVED")], NOW);
    expect(text).toBe("1 מתוך 2 סיימו");
  });

  it("הסלמה מציגה את מספר הימים בפועל", () => {
    const stale = ticket({ escalated: true, lastActivityAt: daysAgo(9) });
    expect(reasonText(stale, [to("SENT")], NOW)).toBe("ללא תנועה 9 ימים");
  });

  it("ממתין לאישור גובר על הסלמה", () => {
    const stale = ticket({ escalated: true, lastActivityAt: daysAgo(12) });
    expect(reasonText(stale, [to("DONE")], NOW)).toBe(he.reason.allDone);
  });

  it("מציג מי מטפל כשאין סיבה דחופה יותר", () => {
    const withHandler = ticket({ handlerName: "דוד" });
    expect(reasonText(withHandler, [to("VIEWED")], NOW)).toBe("דוד מטפל");
  });

  it("הודעה שממתינה למענה מציגה את שם הכותב", () => {
    const waiting = ticket({ awaitingReply: { recipientName: "יוסי" } });
    expect(reasonText(waiting, [to("VIEWED", "יוסי")], NOW)).toBe("יוסי כתב הודעה");
  });

  it("הודעה שממתינה למענה גוברת על הסלמה", () => {
    // הודעה טרייה מסבירה את מיקום הפנייה טוב יותר מ"ללא תנועה 9 ימים".
    const stale = ticket({
      escalated: true,
      lastActivityAt: daysAgo(9),
      awaitingReply: { recipientName: "יוסי" },
    });
    expect(reasonText(stale, [to("SENT", "יוסי")], NOW)).toBe("יוסי כתב הודעה");
  });

  it("הודעה שממתינה למענה גוברת על 'מי מטפל'", () => {
    // "דוד מטפל" מרגיע, וזו בדיוק ההרגעה השגויה כשמישהו בשטח ממתין לתשובה.
    const waiting = ticket({ handlerName: "דוד", awaitingReply: { recipientName: "יוסי" } });
    expect(reasonText(waiting, [to("VIEWED", "יוסי")], NOW)).toBe("יוסי כתב הודעה");
  });

  it("'כולם סיימו' גובר על הודעה שממתינה למענה", () => {
    // סדר מכוון: כשכולם סיימו, מה שנדרש מהמנהל הוא אישור וסגירה — וזו
    // פעולה קונקרטית יותר מ"מישהו כתב". ההודעה עצמה ממתינה לו בשרשור.
    const waiting = ticket({ awaitingReply: { recipientName: "יוסי" } });
    expect(reasonText(waiting, [to("DONE", "יוסי")], NOW)).toBe(he.reason.allDone);
  });

  it("טיוטה מוסברת כטיוטה", () => {
    expect(reasonText(ticket({ isDraft: true }), [], NOW)).toBe(he.reason.draft);
  });

  it("פנייה סגורה מוסברת כסגורה", () => {
    expect(reasonText(ticket({ closedAt: NOW }), [to("DONE")], NOW)).toBe(he.reason.closed);
  });

  it("פנייה בלי נמענים אומרת זאת במפורש ולא נשארת בלי הסבר", () => {
    expect(reasonText(ticket(), [], NOW)).toBe(he.reason.noRecipients);
  });

  it("פנייה שנשלחה וטרם נצפתה אומרת זאת", () => {
    expect(reasonText(ticket(), [to("SENT")], NOW)).toBe(he.reason.awaitingFirstView);
  });

  it("נצפה בלי תגובה אומר זאת", () => {
    expect(reasonText(ticket(), [to("VIEWED")], NOW)).toBe(he.reason.viewedNoReply);
  });

  it("לכל מצב אפשרי יש טקסט סיבה — אף כרטיס לא נשאר בלי הסבר", () => {
    const cases: AssignmentView[][] = [
      [],
      [to("SENT")],
      [to("VIEWED")],
      [to("DONE")],
      [to("REMOVED")],
      [to("DONE"), to("SENT")],
    ];
    // גם עם הדגל וגם בלעדיו: הוא מוסיף ענף לגזירה, ושורה בלי הסבר היא
    // בדיוק מה שגורם לפנייה לקפוץ בין קבוצות בלי שהמשתמש עשה דבר.
    const flags = [null, { recipientName: "יוסי" }];
    for (const assignments of cases) {
      for (const awaitingReply of flags) {
        for (const t of [
          ticket({ awaitingReply }),
          ticket({ isDraft: true, awaitingReply }),
          ticket({ closedAt: NOW, awaitingReply }),
        ]) {
          expect(reasonText(t, assignments, NOW).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("תרגום לעברית", () => {
  it("לכל סטטוס נגזר יש תווית", () => {
    const statuses = [
      "CLOSED",
      "DRAFT",
      "AWAITING_OPENER_APPROVAL",
      "PARTIAL",
      "VIEWED",
      "NEW",
    ] as const;
    for (const status of statuses) {
      expect(he.ticketStatus[status]).toBeTruthy();
    }
  });

  /**
   * טענה מפורשת ולא רק `toBeTruthy`: הנוסח הזה הוא מה שהמנהל קורא בלוח כדי
   * להחליט אם לצאת לשטח או לאשר ולסגור. "ממתין לפותח (אישור)" לא אמר שהעבודה
   * בוצעה, וזו הייתה התקלה שדווחה מהשטח (אפיון §3.5 שורה 4).
   */
  it("פנייה שכל נמעניה סיימו נקראת 'טופל' לפני שהיא מבקשת אישור", () => {
    expect(he.ticketStatus.AWAITING_OPENER_APPROVAL).toBe("טופל — ממתין לאישור סופי");
  });

  it("לכל קבוצה בלוח יש כותרת", () => {
    expect(he.boardSection.ACTION_REQUIRED).toBe("דורש ממך");
    expect(he.boardSection.WITH_RECIPIENTS).toBe("אצל הנמענים");
    expect(he.boardSection.ARCHIVE).toBe("ארכיון");
  });
});
