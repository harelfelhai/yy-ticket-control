import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listProfessionalsForAdmin } from "@/lib/services/admin";
import { ProfessionalsManager } from "./professionals-manager";
import { TITLE_DESCRIPTIVE } from "@/lib/ui";

export const metadata = { title: `${he.admin.professionals} — ${he.app.name}` };

/** ניהול אנשי מקצוע (מסך 13): עריכת פרטים ואיחוד כפילויות. */
export default async function AdminProfessionalsPage() {
  const actor = await requireUser();
  const professionals = await listProfessionalsForAdmin(actor);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div>
        <Link href="/admin" className="text-sm text-brand">
          ← {he.admin.title}
        </Link>
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.professionals}</h1>
      </div>

      {professionals.length === 0 ? (
        <p className="py-8 text-center text-muted">{he.common.noResults}</p>
      ) : (
        <ProfessionalsManager professionals={professionals} />
      )}
    </div>
  );
}
