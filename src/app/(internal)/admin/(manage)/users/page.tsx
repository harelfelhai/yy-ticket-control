import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listSites, listUsers } from "@/lib/services/admin";
import { UsersManager } from "./users-manager";
import { FULL_WIDTH, LINK, PAGE_X } from "@/lib/ui";

export const metadata = { title: `${he.admin.users} — ${he.app.name}` };

/** ניהול משתמשים (מסך 12): הקמה, תפקיד, אתר, והפעלה/השבתה. */
export default async function AdminUsersPage() {
  // בדיקת הרשאה בדף עצמו ולא רק ב-layout: ה-layout אינו רץ מחדש בניווט
  // צד-לקוח בין מסכי אדמין, והשירות אוכף מנהל-מערכת בכל מקרה.
  const actor = await requireUser();
  const [users, sites] = await Promise.all([listUsers(actor), listSites(actor)]);

  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      {/* קו תחתון ולא `text-brand` — ראו `LINK` ב-`src/lib/ui.ts`. */}
      <Link href="/admin" className={`text-sm ${LINK}`}>
        ← {he.admin.title}
      </Link>

      {/* הכותרת ירדה ל-`UsersManager`: כפתור ההוספה צמוד לה, והוא לקוח. */}
      <UsersManager
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          email: u.email,
          role: u.role,
          siteName: u.site?.name ?? null,
          active: u.active,
        }))}
      />
    </div>
  );
}
