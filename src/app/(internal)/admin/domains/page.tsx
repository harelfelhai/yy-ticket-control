import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listDomains } from "@/lib/services/admin";
import { AdminAddForm } from "../admin-add-form";
import { createDomainAction } from "../actions";
import { DomainsList } from "./domains-list";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE } from "@/lib/ui";

export const metadata = { title: `${he.admin.domains} — ${he.app.name}` };

/**
 * ניהול תחומים (מסך 14): הוספה, תיקון שם ומחיקה. הרשימה נלמדת גם דרך
 * הפניות, ולכן המסך הזה אינו התנאי לעבודה אלא הדרך לנקות אחריה.
 */
export default async function AdminDomainsPage() {
  const actor = await requireUser();
  const domains = await listDomains(actor);

  return (
    <div className={`flex flex-col gap-4 p-4 ${CONTENT_WIDTH}`}>
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
