import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listDomains } from "@/lib/services/admin";
import { AdminAddForm } from "../../admin-add-form";
import { createDomainAction } from "../../actions";
import { DomainsList } from "./domains-list";
import { FULL_WIDTH, LINK, PAGE_X, TITLE_DESCRIPTIVE } from "@/lib/ui";

export const metadata = { title: `${he.admin.domains} — ${he.app.name}` };

/**
 * ניהול תחומים (מסך 14): הוספה, תיקון שם ומחיקה. הרשימה נלמדת גם דרך
 * הפניות, ולכן המסך הזה אינו התנאי לעבודה אלא הדרך לנקות אחריה.
 */
export default async function AdminDomainsPage() {
  const actor = await requireUser();
  const domains = await listDomains(actor);

  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      <div>
        {/* קו תחתון ולא `text-brand` — ראו `LINK` ב-`src/lib/ui.ts`. */}
        <Link href="/admin" className={`text-sm ${LINK}`}>
          ← {he.admin.title}
        </Link>
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.domains}</h1>
      </div>

      {/*
       * טופס ההוספה לצד הרשימה, כמו בשאר מסכי הניהול. הרשימה עטופה כדי
       * לקבל את השארית (`flex-1`) בלי ש-`DomainsList` יידע איפה הוא מוצג —
       * הוא רכיב רשימה ולא רכיב עמוד.
       *
       * **המסך הזה נשאר על טופס בצד, ולא עבר לדיאלוג כמו אתרים ומשתמשים
       * ואנשי מקצוע (0.7).** לתחום יש שדה אחד — שם — ודיאלוג סביב שדה
       * בודד מוסיף שתי לחיצות ומסך שנחסם, בלי להוסיף מקום לשום דבר. מה
       * שכן ירד כאן הוא התווית של הכפתור: `buttonStyle="icon"` הופך אותו
       * ל-`+` בשורה אחת עם השדה, והשם הנגיש נשמר ב-`aria-label`.
       */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <AdminAddForm
          label={he.admin.newDomain}
          buttonLabel={he.admin.addDomain}
          action={createDomainAction}
          buttonStyle="icon"
        />

        <div className="min-w-0 flex-1">
          <DomainsList domains={domains.map((d) => ({ id: d.id, name: d.name }))} />
        </div>
      </div>
    </div>
  );
}
