import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listSites } from "@/lib/services/admin";
import { AdminAddForm } from "../admin-add-form";
import { createSiteAction, deleteSiteAction, renameSiteAction } from "../actions";
import { CONTENT_WIDTH, TITLE_DESCRIPTIVE, CARD_LIST, RECORD_NAME} from "@/lib/ui";
import { ButtonLink } from "@/components/ui/button";
import { DeleteButton } from "@/components/delete-button";
import { InlineRename } from "@/components/inline-rename";
import { cardClasses } from "@/components/ui/card";

export const metadata = { title: `${he.admin.sites} — ${he.app.name}` };

/**
 * ניהול אתרים (מסך 11): הקמה, שינוי שם, מחיקה, ושיוך מנהלי העבודה (שנעשה
 * בהקמת המשתמש ומוצג כאן).
 *
 * הבניינים והדירות של האתר יושבים במסך נפרד תחתיו (מסך 16). ההיררכיה אינה
 * קישוט: הייחודיות של שם בניין היא (אתר, שם), ולכן "בניין א׳" קיים בכל אתר
 * ורשימה שטוחה חוצת-אתרים הייתה מציגה כפילויות מדומות.
 */
export default async function AdminSitesPage() {
  const actor = await requireUser();
  const sites = await listSites(actor);

  return (
    <div className={`flex flex-col gap-4 p-4 ${CONTENT_WIDTH}`}>
      <div>
        <Link href="/admin" className="text-sm text-brand">
          ← {he.admin.title}
        </Link>
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.sites}</h1>
      </div>

      <AdminAddForm label={he.admin.siteName} buttonLabel={he.admin.addSite} action={createSiteAction} />

      <ul className={CARD_LIST}>
        {sites.map((site) => (
          <li
            key={site.id}
            className={cardClasses("flex flex-col gap-2")}
          >
            <span className={RECORD_NAME}>{site.name}</span>
            <span className="text-sm text-muted">
              {he.admin.siteManagers}:{" "}
              {site.users.length === 0
                ? he.admin.noManagers
                : site.users.map((u) => u.name).join(", ")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {/*
               * ‏`ButtonLink` ולא `Link` מעוצב: זו פעולה בתוך שורה לצד שינוי
               * שם ומחיקה, ולכן היא כפופה לרצפת 44px כמותן. קישור טקסט
               * ב-`text-sm` היה 20px — האוכף ב-`rtl-mobile` תפס אותו.
               *
               * ‏`secondary` ולא `quiet`: הכניסה לבניינים היא הפעולה שבגללה
               * מגיעים לשורה, ושני פקדי `quiet` צמודים בצבע המותג נקראים
               * כאותו דבר. המסגרת מבדילה ניווט מפעולה (DESIGN.md § שקט).
               */}
              <ButtonLink
                href={`/admin/sites/${site.id}`}
                variant="secondary"
                size="compact"
              >
                {he.admin.buildings}
              </ButtonLink>
              <InlineRename value={site.name} action={renameSiteAction.bind(null, site.id)} />
              <DeleteButton name={site.name} action={deleteSiteAction.bind(null, site.id)} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
