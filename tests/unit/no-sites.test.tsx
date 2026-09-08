import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoSites } from "@/app/(internal)/tickets/no-sites";
import { he } from "@/lib/he";
import type { SessionUser } from "@/lib/session";

/**
 * המסך שרואים כששני מסכי הפתיחה אינם יכולים להיפתח — אין במערכת אף אתר.
 *
 * **מה שנשבר כאן בפועל.** מנהל מערכת שניסה לפתוח פנייה קיבל
 * "לא משויך אתר. פנה למנהל המערכת." — משפט ששגה פעמיים: הוא תיאר שיוך של
 * משתמש בעוד שהתנאי בודק את **טבלת האתרים כולה**, והוא שלח את מנהל המערכת
 * לפנות לעצמו. הבדיקה נועדה למנוע את החזרה של שני הפגמים.
 *
 * `user` ולא `viewer`: זה מה שהעמודים מחזיקים ביד (`requireUser()`),
 * וההמרה היא באחריות הרכיב — כך אין דרך להעביר לו צופה של פורטל בטעות.
 */

function user(role: SessionUser["role"], siteId: string | null = null): SessionUser {
  return { id: "u1", name: "בודק", role, siteId };
}

describe("מצב ריק — אין אתרים במערכת", () => {
  it("מנהל מערכת מקבל את הפעולה שממלאת את המסך", () => {
    render(<NoSites user={user("ADMIN")} />);

    expect(screen.getByText(he.ticket.noSites)).toBeInTheDocument();

    const action = screen.getByRole("link", { name: he.admin.newSiteButton });
    /*
     * `?new=1` הוא כל ההבדל בין "לך למסך האתרים" ל"צור אתר": במערכת ריקה
     * הכפתור מוביל לדיאלוג ההקמה עצמו (`sites-manager.tsx`), ובלעדיו
     * המנהל נוחת על מסך ריק אחר.
     */
    expect(action).toHaveAttribute("href", "/admin/sites?new=1");
  });

  /**
   * בעלים רואה את אותה עובדה בלי הפעולה — `canManageAdmin` חוסם אותו
   * מ-`/admin/sites`, וכפתור שמפנה למסך שיחזיר אותו ללוח בלי הסבר גרוע
   * מהיעדרו. הנוסח שלו הוא היחיד שבו "פנה למנהל המערכת" עדיין נכון.
   */
  it("בעלים מקבל את העובדה בלי כפתור שיחזיר אותו ללוח", () => {
    render(<NoSites user={user("OWNER")} />);

    expect(screen.getByText(he.ticket.noSitesContactAdmin)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  /**
   * מנהל עבודה מגיע לכאן רק אם האתר שהוא משויך אליו נמחק — מצב נדיר, אבל
   * הנוסח חייב להיות נכון גם בו. הוא אינו רשאי להקים אתר.
   */
  it("מנהל עבודה אינו מקבל כפתור", () => {
    render(<NoSites user={user("SITE_MANAGER", "s1")} />);

    expect(screen.getByText(he.ticket.noSitesContactAdmin)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  /**
   * הטענה שהמשפט **אינו** מדבר על שיוך. זו הטעות שהייתה כאן, והיא חזרה
   * ותחזור כל עוד המילה "משויך" תיראה סבירה למי שקורא רק את שם התנאי.
   */
  it("אף נוסח אינו מדבר על שיוך של המשתמש", () => {
    for (const role of ["ADMIN", "OWNER"] as const) {
      const { unmount } = render(<NoSites user={user(role)} />);
      expect(document.body.textContent).not.toContain("לא משויך");
      unmount();
    }
  });
});
