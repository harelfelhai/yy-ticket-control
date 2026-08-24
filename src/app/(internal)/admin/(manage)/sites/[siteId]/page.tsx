import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/delete-button";
import { InlineRename } from "@/components/inline-rename";
import { cardClasses } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { AdminError, listSiteTree } from "@/lib/services/admin";
import {
  FULL_WIDTH,
  PAGE_X,
  LINK,
  TITLE_DESCRIPTIVE,
  TITLE_IDENTIFYING,
  CARD_LIST,
  ROW_LIST,
  RECORD_NAME,
} from "@/lib/ui";
import { AdminAddForm } from "../../../admin-add-form";
import {
  createApartmentAction,
  createBuildingAction,
  deleteApartmentAction,
  deleteBuildingAction,
  renameApartmentAction,
  renameBuildingAction,
} from "../../../actions";

export const metadata = { title: `${he.admin.buildings} — ${he.app.name}` };

/**
 * בניינים ודירות של אתר (מסך 16).
 *
 * **למה המסך הזה קיים.** הבניינים והדירות נלמדים תוך כדי עבודה — מנהל
 * שמקליד שם שאינו קיים יוצר אותו — וזו הכרעה שנשארת. אבל למידה תוך כדי
 * פירושה גם ששגיאת הקלדה הופכת לבניין שלישי, ושמנהל שרוצה להכין אתר חדש
 * מראש לא מצא איפה. שני אלה נסגרים כאן, בלי לבטל את ההזנה תוך כדי.
 *
 * **מונה הפניות אינו קישוט.** הוא מה שמאפשר להחליט מה בטוח למחוק לפני
 * שלוחצים: מחיקה של רשומה שיש אליה הפניות נחסמת ומחזירה הסבר, ומי שרואה
 * "אין פניות" יודע מראש שהשורה פנויה.
 */
export default async function AdminSiteBuildingsPage(
  props: PageProps<"/admin/sites/[siteId]">,
) {
  const { siteId } = await props.params;
  const actor = await requireUser();

  // אתר שאינו קיים הוא 404 ולא שגיאת פעולה: הנתיב עצמו אינו מצביע על דבר.
  // שגיאת הרשאה ממשיכה להיזרק ונתפסת ב-layout של אזור הניהול.
  let tree: Awaited<ReturnType<typeof listSiteTree>>;
  try {
    tree = await listSiteTree(actor, siteId);
  } catch (error) {
    if (error instanceof AdminError && error.message === he.admin.siteNotFound) notFound();
    throw error;
  }

  const { site, buildings } = tree;

  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      <div>
        {/* קו תחתון ולא `text-brand` — ראו `LINK` ב-`src/lib/ui.ts`. */}
        <Link href="/admin/sites" className={`text-sm ${LINK}`}>
          ← {he.admin.sites}
        </Link>
        <h1 className={TITLE_IDENTIFYING}>{site.name}</h1>
        <p className="text-sm text-muted">{he.admin.buildings}</p>
      </div>

      {/*
       * טופס "בניין חדש" לצד רשימת הבניינים, כמו בשאר מסכי הניהול. הרוחב
       * מגיע מ-`AdminAddForm`; כאן נקבע רק טור מול שורה.
       *
       * טופס "הוסף דירה" **אינו** עולה לכאן ונשאר בתוך הבניין שלו — הוא
       * מוסיף לרשימה המקוננת, ומחוצה לה הוא נקרא כשייך לאתר.
       */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <AdminAddForm
          label={he.admin.buildingName}
          buttonLabel={he.admin.addBuilding}
          action={createBuildingAction.bind(null, siteId)}
        />

        {buildings.length === 0 ? (
          <EmptyState className="min-w-0 flex-1">{he.admin.noBuildings}</EmptyState>
        ) : (
          <ul className={`${CARD_LIST} min-w-0 flex-1`}>
            {buildings.map((building) => (
              <li key={building.id} className={cardClasses("flex flex-col gap-2")}>
                {/*
                 * ‏`h2` ולא `span`: הבניין הוא כותרת קיבוץ שמתחתיה רשימת דירות,
                 * וזה גם המבנה שקורא מסך מקבל. ההבחנה בין הרמות אינה יכולה
                 * להישען על 100 יחידות משקל בלבד — על מסך בשמש זה האות החלש
                 * ביותר שיש, וזו המגבלה המרכזית של המערכת.
                 *
                 * בלי `flex-1`: אלמנט לא נדחף לקצה הנגדי של מיכל רחב (§ Layout).
                 * ‏`flex-1` על ילד יחיד מייצר בדיוק את מה ש-`justify-between`
                 * מייצר, ולכן הוא חומק מהאוכף שסורק את שם המחלקה.
                 */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className={TITLE_DESCRIPTIVE}>{building.name}</h2>
                  <span className="text-sm text-muted">
                    {he.admin.linkedTickets(building.ticketCount)}
                  </span>
                  <InlineRename
                    value={building.name}
                    action={renameBuildingAction.bind(null, siteId, building.id)}
                  />
                  <DeleteButton
                    name={building.name}
                    action={deleteBuildingAction.bind(null, siteId, building.id)}
                  />
                </div>

                {/*
                 * הדירות בתוך הבניין. הזחה וקו התחלה במקום כרטיס מקונן —
                 * היררכיה של שתי רמות אינה זקוקה לשני משטחים.
                 *
                 * טופס "הוסף דירה" יושב **בתוך** ההזחה ולא מתחתיה: הוא מוסיף
                 * לרשימה הזו, ומחוצה לה הוא נקרא כשייך לבניין.
                 */}
                <div className="flex flex-col gap-2 border-s border-border ps-3">
                  {building.apartments.length === 0 ? (
                    <p className="text-sm text-muted">{he.admin.noApartments}</p>
                  ) : (
                    <ul className={ROW_LIST}>
                      {building.apartments.map((apartment) => (
                        <li
                          key={apartment.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-2"
                        >
                          <span className={RECORD_NAME}>
                            {he.directory.apartment} {apartment.number}
                          </span>
                          {apartment.residentName ? (
                            <span className="text-sm text-muted">
                              {he.admin.resident(apartment.residentName)}
                            </span>
                          ) : null}
                          <span className="text-sm text-muted">
                            {he.admin.linkedTickets(apartment.ticketCount)}
                          </span>
                          {/*
                           * השם הנגיש נושא גם את הבניין. "דירה 1" קיימת בכל
                           * בניין באתר, ובלעדיו שני כפתורים במסך אחד נושאים
                           * את אותו שם והאישור אינו אומר איזו דירה נמחקת.
                           */}
                          <InlineRename
                            value={apartment.number}
                            name={he.ticket.location(building.name, apartment.number)}
                            inputMode="numeric"
                            action={renameApartmentAction.bind(null, siteId, apartment.id)}
                          />
                          <DeleteButton
                            name={he.ticket.location(building.name, apartment.number)}
                            action={deleteApartmentAction.bind(null, siteId, apartment.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}

                  <AdminAddForm
                    surface="plain"
                    inputMode="numeric"
                    label={he.admin.apartmentNumber}
                    buttonLabel={he.admin.addApartment}
                    action={createApartmentAction.bind(null, siteId, building.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
