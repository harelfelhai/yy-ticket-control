import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listDomains } from "@/lib/services/admin";
import { AdminAddForm } from "../admin-add-form";
import { createDomainAction } from "../actions";
import { DomainsList } from "./domains-list";
import { TITLE_DESCRIPTIVE } from "@/lib/ui";

export const metadata = { title: `${he.admin.domains} — ${he.app.name}` };

/** ניהול תחומים (מסך 14): הוספה ותיקון שם. הרשימה נלמדת גם דרך הפניות. */
export default async function AdminDomainsPage() {
  const actor = await requireUser();
  const domains = await listDomains(actor);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div>
        <Link href="/admin" className="text-sm text-brand">
          ← {he.admin.title}
        </Link>
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.domains}</h1>
      </div>

      <AdminAddForm
        label={he.admin.newDomain}
        buttonLabel={he.admin.addDomain}
        action={createDomainAction}
      />

      <DomainsList domains={domains.map((d) => ({ id: d.id, name: d.name }))} />
    </div>
  );
}
