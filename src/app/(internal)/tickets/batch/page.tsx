import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { he } from "@/lib/he";
import { listSiteDirectory } from "@/lib/services/directory";
import { ButtonLink } from "@/components/ui/button";
import { BatchForm } from "./batch-form";
import { CARD_LIST, CONTENT_WIDTH, PAGE_X, TITLE_DESCRIPTIVE } from "@/lib/ui";

export const metadata = { title: `${he.batch.title} — ${he.app.name}` };

/**
 * מסך ההזנה המרוכזת מדוח בדק בית (מסך 5).
 *
 * בחירת האתר זהה למסך היצירה: מנהל עבודה משויך לאתר אחד; מנהל מערכת ובעלים
 * בוחרים במפורש, כדי שעשרות פניות לא ישויכו לאתר הלא נכון בבת אחת.
 */
export default async function BatchPage(props: PageProps<"/tickets/batch">) {
  const user = await requireUser();
  const { site: requestedSiteId } = await props.searchParams;

  const sites = user.siteId
    ? await db.site.findMany({ where: { id: user.siteId } })
    : await db.site.findMany({ orderBy: { name: "asc" } });

  if (sites.length === 0) {
    // המסך עצמו רחב, אבל ענף הכשל הוא משפט אחד שקוראים — ולכן `CONTENT_WIDTH`
    // ולא `FULL_WIDTH`. בלי קבוע כלשהו הוא נמתח על מסך שלם מאז שה-`<main>`
    // חדל להגביל.
    return <p className={`py-3 ${PAGE_X} ${CONTENT_WIDTH} text-muted`}>{he.ticket.noSite}</p>;
  }

  const site = sites.length === 1 ? sites[0] : sites.find((s) => s.id === requestedSiteId);

  if (!site) {
    return (
      // בחירת אתר היא מסך של משפט ורשימה קצרה — קוראים אותו, לא סורקים —
      // ולכן `CONTENT_WIDTH` כמו ענף הכשל שמעליו, והריפוד מ-`PAGE_X` ולא
      // ‏`p-6` כתוב ביד.
      <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${CONTENT_WIDTH}`}>
        <h1 className={TITLE_DESCRIPTIVE}>{he.batch.title}</h1>
        <p className="text-muted">{he.ticket.chooseSite}</p>
        {/* פריטים נפרדים ולא שורות של פריט אחד: כל אתר הוא בחירה עומדת
            בפני עצמה, ולכן `CARD_LIST`. */}
        <ul className={CARD_LIST}>
          {sites.map((option) => (
            <li key={option.id}>
              {/*
               * היה כאן כפתור משני כתוב ביד — `min-h-12 rounded-xl border
               * border-border bg-surface px-4 text-base font-medium` — כלומר
               * הספציפיקציה של `secondary` משוכפלת מזיכרון, ובגרסה שקדמה
               * לסקאלת הצורות (`rounded-xl`) ולרצפת המגע התלויה במכשיר.
               *
               * הפרימיטיב גם מצמצם את הכפתור לרוחב הטקסט במקום למתוח אותו
               * על כל העמוד: `flex` על `<a>` הפך אותו לבלוק, ומאז שאין תקרה
               * על ה-`<main>` פירוש הדבר היה שם אתר אחד בקצה כפתור של מסך
               * שלם.
               */}
              <ButtonLink href={`/tickets/batch?site=${option.id}`} variant="secondary">
                {option.name}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const [directory, internalUsers] = await Promise.all([
    listSiteDirectory(site.id),
    db.user.findMany({
      where: { active: true, OR: [{ siteId: site.id }, { siteId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  return (
    <BatchForm
      siteId={site.id}
      siteName={site.name}
      buildings={directory.buildings.map((building) => ({
        id: building.id,
        label: building.name,
        apartments: building.apartments.map((a) => ({ id: a.id, label: a.number })),
      }))}
      domains={directory.domains.map((d) => ({ id: d.id, label: d.name }))}
      recipients={[
        ...directory.professionals.map((p) => ({
          id: p.id,
          label: p.name,
          hint: p.phone ?? p.email ?? undefined,
          kind: "professional" as const,
        })),
        ...internalUsers.map((u) => ({
          id: u.id,
          label: u.name,
          hint: he.role[u.role],
          kind: "user" as const,
        })),
      ]}
    />
  );
}
