import Link from "next/link";
import { he } from "@/lib/he";
import { listSites, listUsers } from "@/lib/services/admin";
import { UsersManager } from "./users-manager";

export const metadata = { title: `${he.admin.users} — ${he.app.name}` };

/** ניהול משתמשים (מסך 12): הקמה, תפקיד, אתר, והפעלה/השבתה. */
export default async function AdminUsersPage() {
  const [users, sites] = await Promise.all([listUsers(), listSites()]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div>
        <Link href="/admin" className="text-sm text-brand">
          ← {he.admin.title}
        </Link>
        <h1 className="text-xl font-bold">{he.admin.users}</h1>
      </div>

      <UsersManager
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          role: u.role,
          siteName: u.site?.name ?? null,
          active: u.active,
        }))}
      />
    </div>
  );
}
