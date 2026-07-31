import Link from "next/link";
import { he } from "@/lib/he";
import { TITLE_DESCRIPTIVE } from "@/lib/ui";

export const metadata = { title: `${he.admin.title} — ${he.app.name}` };

/**
 * רכזת הניהול (מסכים 11–15). התגיות מנוהלות במסך התגיות הקיים (`/tags`),
 * ולכן הן קישור החוצה ולא מסך נוסף — מקור אמת אחד.
 */
export default function AdminHubPage() {
  const cards: { href: string; label: string }[] = [
    { href: "/admin/sites", label: he.admin.sites },
    { href: "/admin/users", label: he.admin.users },
    { href: "/admin/professionals", label: he.admin.professionals },
    { href: "/admin/domains", label: he.admin.domains },
    { href: "/tags", label: he.admin.manageTags },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className={TITLE_DESCRIPTIVE}>{he.admin.title}</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="flex min-h-16 items-center rounded-2xl border border-border bg-surface px-4 font-semibold"
            >
              {card.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
