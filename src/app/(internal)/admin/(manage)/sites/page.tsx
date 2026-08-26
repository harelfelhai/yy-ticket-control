import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listAssignableSiteManagers, listSites } from "@/lib/services/admin";
import { FULL_WIDTH, PAGE_X, LINK } from "@/lib/ui";
import { SitesManager } from "./sites-manager";

export const metadata = { title: `${he.admin.sites} — ${he.app.name}` };

/**
 * ניהול אתרים (מסך 11): הקמה, שינוי שם, מחיקה, ושיוך מנהלי העבודה.
 *
 * הבניינים והדירות של האתר יושבים במסך נפרד תחתיו (מסך 16). ההיררכיה אינה
 * קישוט: הייחודיות של שם בניין היא (אתר, שם), ולכן "בניין א׳" קיים בכל אתר
 * ורשימה שטוחה חוצת-אתרים הייתה מציגה כפילויות מדומות.
 *
 * **‏0.7: המסך עבר לתבנית "כרטיס סיכומי → דיאלוג פרטים".** שני הדיאלוגים
 * ובורר המנהלים דורשים מצב לקוח, ולכן העמוד מוסר את כל התצוגה ל-
 * `SitesManager` ונשאר מה שהוא צריך להיות — שליפה והרשאה.
 *
 * **שיוך מנהלי עבודה נוסף כאן ולא היה קיים לפניו:** ‏`User.siteId` נקבע
 * בהקמת המשתמש בלבד, ולא הייתה שום דרך להזיז מנהל בין אתרים או לתת אתר
 * חדש למנהל קיים.
 */
export default async function AdminSitesPage() {
  const actor = await requireUser();
  const [sites, managers] = await Promise.all([
    listSites(actor),
    listAssignableSiteManagers(actor),
  ]);

  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      {/*
       * קו תחתון ולא `text-brand`: בפלטת הגרפיט צבע המותג הוא בפועל צבע
       * הטקסט, וקישור שמסומן בו בלבד חדל להיראות לחיץ (`LINK`, § Do's).
       */}
      <Link href="/admin" className={`text-sm ${LINK}`}>
        ← {he.admin.title}
      </Link>

      <SitesManager
        managers={managers}
        sites={sites.map((site) => ({
          id: site.id,
          name: site.name,
          managers: site.users.map((user) => ({ id: user.id, name: user.name })),
          buildingCount: site._count.buildings,
          ticketCount: site._count.tickets,
        }))}
      />
    </div>
  );
}
