import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { he } from "@/lib/he";

/**
 * **התבנית "כרטיס סיכומי → דיאלוג פרטים" (0.7).**
 *
 * שלושת מסכי הניהול — אתרים, משתמשים, אנשי מקצוע — עברו מ"פעולות בכל
 * שורה" ל"כרטיס לחיץ שנפתח לדיאלוג". הבדיקות כאן שומרות על מה שההעברה
 * הזו יכולה לשבור בשקט:
 *
 * ‏1. **הכרטיס הוא יעד אחד על כל השטח** (§ אזורי מגע), ואין בו פקד מקונן.
 *    ‏`<button>` בתוך `<button>` הוא HTML לא חוקי, ומי שיחזיר "מחק" לפינת
 *    הכרטיס ישבור גם את זה וגם את הלחיצה על הכרטיס עצמו.
 * ‏2. **הפרטים שירדו מהכרטיס באמת מגיעים לדיאלוג.** טלפון ומייל ירדו
 *    מהשורה; אם הם גם לא הופיעו בדיאלוג, המידע פשוט נעלם מהמערכת.
 * ‏3. **הדיאלוג נגזר מה-props ולא מועתק למצב.** זה הבאג העדין בתבנית:
 *    אחרי שמירה ה-RSC מרנדר מחדש, ועותק ב-`useState` היה מקפיא את
 *    הדיאלוג על הערך שלפני השמירה.
 */

const actions = vi.hoisted(() => ({
  createSiteAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  renameSiteAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  deleteSiteAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  setSiteManagersAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  createUserAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  updateUserAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  setUserActiveAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  createProfessionalAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  updateProfessionalAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  setProfessionalActiveAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  deleteProfessionalAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
  mergeProfessionalsAction: vi.fn(async () => ({ ok: true as const, data: "" })),
}));

vi.mock("@/app/(internal)/admin/actions", () => actions);

const { SitesManager } = await import("@/app/(internal)/admin/(manage)/sites/sites-manager");
const { UsersManager } = await import("@/app/(internal)/admin/(manage)/users/users-manager");
const { ProfessionalsManager } = await import(
  "@/app/(internal)/admin/(manage)/professionals/professionals-manager"
);

const SITES = [
  {
    id: "s1",
    name: "פרויקט הדר",
    managers: [{ id: "u1", name: "יוסי" }],
    buildingCount: 3,
    ticketCount: 56,
  },
];

const MANAGERS = [
  { id: "u1", name: "יוסי", siteId: "s1", siteName: "פרויקט הדר" },
  { id: "u2", name: "רונית", siteId: "s2", siteName: "מגדלי הצפון" },
  { id: "u3", name: "דנה", siteId: null, siteName: null },
];

const USERS = [
  {
    id: "u1",
    name: "שירה לוי",
    phone: "0505555555",
    email: "shira@example.com",
    role: "SITE_MANAGER" as const,
    siteName: "מגדלי הצפון",
    active: true,
  },
];

const PROFESSIONALS = [
  {
    id: "p1",
    name: "אבי דגן",
    phone: "0521234567",
    email: null,
    active: true,
    activeAssignments: 8,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("כרטיס רשומה — יעד אחד, בלי פקד מקונן", () => {
  it.each([
    ["אתרים", () => render(<SitesManager sites={SITES} managers={MANAGERS} />), "פרויקט הדר"],
    ["משתמשים", () => render(<UsersManager sites={[]} users={USERS} />), "שירה לוי"],
    [
      "אנשי מקצוע",
      () => render(<ProfessionalsManager professionals={PROFESSIONALS} />),
      "אבי דגן",
    ],
  ])("‏%s: הכרטיס הוא כפתור יחיד ואין בתוכו פקד נוסף", (_label, mount, name) => {
    mount();
    const card = screen.getByRole("button", { name });

    expect(card.closest("li")).not.toBeNull();
    /*
     * הטענה היא על **צאצאים לחיצים**, ולא על מספר הכפתורים במסך: כפתור
     * ההוספה שלצד הכותרת הוא כפתור לגיטימי מחוץ לכרטיס.
     */
    expect(card.querySelectorAll("button, a, input, select")).toHaveLength(0);
  });

  it.each([
    ["אתרים", () => render(<SitesManager sites={SITES} managers={MANAGERS} />), "פרויקט הדר"],
    ["משתמשים", () => render(<UsersManager sites={[]} users={USERS} />), "שירה לוי"],
    [
      "אנשי מקצוע",
      () => render(<ProfessionalsManager professionals={PROFESSIONALS} />),
      "אבי דגן",
    ],
  ])("‏%s: הכרטיס ממלא את תא הגריד — שורה בגובה אחד", (_label, mount, name) => {
    /**
     * **‏`h-full` ולא רק `w-full`, מ-0.8.**
     *
     * הרשימה עברה ל-`RECORD_CARD_GRID`, ושם ה-`<li>` נמתח לגובה
     * השורה (`align-items: stretch`) — אבל הכפתור שבתוכו נשא רוחב
     * בלבד. כרטיס עם שורת סיכום קצרה היה נמוך משכניו, והשורה
     * נראתה משוננת. זו תקלה חזותית בלבד, ולכן אף בדיקה אחרת
     * בפרויקט אינה רואה אותה.
     */
    mount();
    const card = screen.getByRole("button", { name });

    expect(card).toHaveClass("h-full");
    expect(card).toHaveClass("w-full");
  });
});

describe("דיאלוג פרטי אתר", () => {
  function open() {
    render(<SitesManager sites={SITES} managers={MANAGERS} />);
    return userEvent.setup();
  }

  it("לחיצה על הכרטיס פותחת דיאלוג עם המונים שירדו ממנו", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "פרויקט הדר" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: he.admin.siteDetails })).toBeVisible();
    // המונים הם מה שאומר, לפני הלחיצה על פח הזבל, אם המחיקה תיחסם.
    expect(dialog).toHaveTextContent("3 בניינים");
    expect(dialog).toHaveTextContent("56 פניות");
  });

  it("מנהל שמשויך לאתר אחר מסומן ככזה — השיוך הוא העברה ולא הוספה", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "פרויקט הדר" }));
    const dialog = screen.getByRole("dialog");

    // רונית משויכת ל"מגדלי הצפון" — סימונה כאן תוציא אותה משם.
    expect(dialog).toHaveTextContent(he.admin.managerCurrentSite("מגדלי הצפון"));
    // דנה אינה משויכת לאף אתר, ולכן אין ממה להעביר אותה.
    expect(dialog).toHaveTextContent(he.admin.managerNoSite);
    // יוסי כבר באתר הזה — הוא אינו "עובר" לשום מקום.
    expect(dialog).not.toHaveTextContent(he.admin.managerCurrentSite("פרויקט הדר"));
  });

  it("כפתור השמירה מופיע רק אחרי שינוי בשיוך", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "פרויקט הדר" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByRole("button", { name: he.common.save })).toBeNull();

    await user.click(within(dialog).getByRole("checkbox", { name: /רונית/ }));
    await user.click(within(dialog).getByRole("button", { name: he.common.save }));

    expect(actions.setSiteManagersAction).toHaveBeenCalledWith("s1", ["u1", "u2"]);
  });

  it("‏Escape סוגר את הדיאלוג", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "פרויקט הדר" }));
    expect(screen.getByRole("dialog")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("המחיקה יושבת בדיאלוג, עוברת אישור, ונוקבת בשם", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = open();
    await user.click(screen.getByRole("button", { name: "פרויקט הדר" }));

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: `${he.admin.delete} פרויקט הדר`,
      }),
    );

    expect(confirm).toHaveBeenCalledWith(he.admin.deleteConfirm("פרויקט הדר"));
    expect(actions.deleteSiteAction).toHaveBeenCalled();
  });

  it("הקישור לבניינים ודירות עבר לדיאלוג ולא נמחק", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "פרויקט הדר" }));

    /*
     * ‏`visual/capture.spec.ts` מנווט למסך 16 דרך הקישור הזה. הוא ירד
     * מהכרטיס לדיאלוג, ולכן זרימת הצילום עודכנה — והבדיקה כאן היא מה
     * שיתפוס אם הוא ייעלם לגמרי.
     */
    expect(
      within(screen.getByRole("dialog")).getByRole("link", { name: he.admin.buildings }),
    ).toHaveAttribute("href", "/admin/sites/s1");
  });
});

describe("דיאלוג פרטי משתמש", () => {
  it("מציג את פרטי הקשר שירדו מהכרטיס", async () => {
    render(<UsersManager sites={[]} users={USERS} />);
    const user = userEvent.setup();

    // הכרטיס עצמו אינו נושא אותם — הוא מסכם בתפקיד ובאתר.
    const card = screen.getByRole("button", { name: "שירה לוי" });
    expect(card).not.toHaveTextContent("0505555555");

    await user.click(card);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("0505555555");
    expect(dialog).toHaveTextContent("shira@example.com");
  });

  it("העיפרון פותח עריכה, והשם הנגיש שלו הוא התווית שהייתה גלויה", async () => {
    render(<UsersManager sites={[]} users={USERS} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "שירה לוי" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: he.admin.editUser }));

    const nameField = within(dialog).getByLabelText(he.admin.userName);
    await user.clear(nameField);
    await user.type(nameField, "שירה כהן");
    await user.click(within(dialog).getByRole("button", { name: he.common.save }));

    expect(actions.updateUserAction).toHaveBeenCalledWith("u1", {
      name: "שירה כהן",
      phone: "0505555555",
      email: "shira@example.com",
    });
  });

  it("אין מחיקת משתמש — ההיסטוריה ב-SetNull ומחיקה הייתה מוחקת אותה בשקט", async () => {
    render(<UsersManager sites={[]} users={USERS} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "שירה לוי" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /^מחק/ })).toBeNull();
    // ההשבתה היא המסלול, והיא כן קיימת.
    expect(within(dialog).getByRole("button", { name: he.admin.deactivate })).toBeVisible();
  });
});

describe("מסך אנשי מקצוע — היכולת שנוספה", () => {
  it("הוספת איש מקצוע נפתחת מכפתור ושולחת את הפרטים", async () => {
    render(<ProfessionalsManager professionals={PROFESSIONALS} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: he.admin.newProfessionalButton }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(he.admin.userName), "חשמלאי חדש");
    await user.type(within(dialog).getByLabelText(he.admin.userPhone), "0521111111");
    await user.click(within(dialog).getByRole("button", { name: he.admin.addProfessional }));

    expect(actions.createProfessionalAction).toHaveBeenCalledWith({
      name: "חשמלאי חדש",
      phone: "0521111111",
      email: undefined,
    });
  });

  it("שדות העריכה נושאים תוויות — עד 0.7 הם היו שלושה Input עירומים", async () => {
    render(<ProfessionalsManager professionals={PROFESSIONALS} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "אבי דגן" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: he.admin.editProfessional }));

    // § Field: תווית תמיד גלויה, לעולם לא placeholder בלבד.
    expect(within(dialog).getByLabelText(he.admin.userName)).toHaveValue("אבי דגן");
    expect(within(dialog).getByLabelText(he.admin.userPhone)).toHaveValue("0521234567");
    expect(within(dialog).getByLabelText(he.admin.userEmail)).toHaveValue("");
  });

  it("האיחוד ירד לדיאלוג ואינו תופס עוד פאנל קבוע", async () => {
    render(<ProfessionalsManager professionals={PROFESSIONALS} />);
    const user = userEvent.setup();

    // לפני הלחיצה הבוררים אינם על המסך כלל.
    expect(screen.queryByLabelText(he.admin.mergeKeep)).toBeNull();

    await user.click(screen.getByRole("button", { name: he.admin.mergeButtonOpen }));
    expect(screen.getByLabelText(he.admin.mergeKeep)).toBeVisible();
    expect(screen.getByLabelText(he.admin.mergeDrop)).toBeVisible();
  });

  it("המצב הריק אינו מסתיר את כפתור ההוספה שנועד למלא אותו", () => {
    /*
     * זה היה באג אמיתי בדרך: המצב הריק היה ענף **אח** לרכיב כולו
     * ב-`page.tsx`, כלומר כשאין אף איש מקצוע הוא החליף את הרכיב —
     * ואיתו את הכפתור החדש. מסך ריק בלי דרך למלא אותו הוא מסך מת.
     */
    render(<ProfessionalsManager professionals={[]} />);

    expect(screen.getByText(he.common.noResults)).toBeVisible();
    expect(screen.getByRole("button", { name: he.admin.newProfessionalButton })).toBeVisible();
  });
});
