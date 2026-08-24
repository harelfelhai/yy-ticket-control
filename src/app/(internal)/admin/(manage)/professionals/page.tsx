import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listProfessionalsForAdmin } from "@/lib/services/admin";
import { ProfessionalsManager } from "./professionals-manager";
import { FULL_WIDTH, LINK, PAGE_X, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: `${he.admin.professionals} — ${he.app.name}` };

/** ניהול אנשי מקצוע (מסך 13): עריכת פרטים ואיחוד כפילויות. */
export default async function AdminProfessionalsPage() {
  const actor = await requireUser();
  const professionals = await listProfessionalsForAdmin(actor);

  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      <div>
        {/* קו תחתון ולא `text-brand` — ראו `LINK` ב-`src/lib/ui.ts`. */}
        <Link href="/admin" className={`text-sm ${LINK}`}>
          ← {he.admin.title}
        </Link>
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.professionals}</h1>
      </div>

      {professionals.length === 0 ? (
        <EmptyState>{he.common.noResults}</EmptyState>
      ) : (
        <ProfessionalsManager professionals={professionals} />
      )}
    </div>
  );
}
