"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { DeleteButton } from "@/components/delete-button";
import { InlineRename } from "@/components/inline-rename";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import {
  DIALOG_SCROLL_BODY,
  RECORD_CARD_GRID,
  RECORD_NAME,
  TITLE_DESCRIPTIVE,
} from "@/lib/ui";
import { useAction } from "@/lib/use-action";
import { RecordCard } from "../../record-card";
import {
  createSiteAction,
  deleteSiteAction,
  renameSiteAction,
  setSiteManagersAction,
} from "../../actions";
import { type ManagerOption, SiteManagersField } from "./site-managers-field";

export interface SiteRow {
  id: string;
  name: string;
  managers: { id: string; name: string }[];
  buildingCount: number;
  ticketCount: number;
}

/**
 * ניהול אתרים (מסך 11), בתבנית של 0.7: כפתור הוספה לצד הכותרת, כרטיס
 * סיכומי לחיץ, וכל הפרטים והפעולות בדיאלוג.
 *
 * **מה ירד מהמסך.** ‏`AdminAddForm` שישב בצד קבוע, ושלושת הפקדים שישבו
 * בכל שורה ("בניינים ודירות" · עיפרון · פח). הרשימה חזרה להיות רשימה.
 */
export function SitesManager({
  sites,
  managers,
}: {
  sites: SiteRow[];
  managers: ManagerOption[];
}) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  /*
   * הרשומה הפתוחה נגזרת מ-`sites` בכל רינדור ואינה מוחזקת בעצמה במצב.
   *
   * זו אינה קוסמטיקה: אחרי שינוי שם או שיוך מנהלים ה-RSC מרנדר מחדש עם
   * הנתונים החדשים, ועותק שנשמר ב-`useState` היה מקפיא את הדיאלוג על
   * הערך הישן — כלומר המשתמש מציל שם, רואה את הרשימה מתעדכנת מאחור,
   * והדיאלוג שלפניו ממשיך להראות את השם הקודם.
   */
  const open = sites.find((site) => site.id === openId) ?? null;

  return (
    <>
      {/*
       * הכפתור **צמוד לכותרת** ולא נדחף לקצה הנגדי (§ Layout): פעולה
       * שמתייחסת לכותרת נצמדת אליה. ב-RTL זה מציב אותו משמאל ל"אתרים",
       * וזו גם הבקשה שנוסחה כך במפורש.
       */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.sites}</h1>
        {/*
         * ‏`aria-label` **זהה לטקסט הגלוי**, ולא במקומו.
         *
         * ‏`primitives.test.ts` דורש `aria-label` מכל כפתור שיש בו אייקון,
         * גם כשיש לצדו טקסט — האוכף נוסח רחב בכוונה, מפני ש"האם יש כאן גם
         * טקסט" אינה שאלה שסריקת מחרוזת יכולה לענות עליה. התגובה הנכונה
         * להסתמנות היא להוסיף את התווית, לא להחליש את האוכף (§ אייקונים).
         */}
        <Button
          size="compact"
          onClick={() => setCreating(true)}
          aria-label={he.admin.newSiteButton}
        >
          <Plus className="me-1 size-3" aria-hidden="true" />
          {he.admin.newSiteButton}
        </Button>
      </div>

      <ul className={RECORD_CARD_GRID}>
        {sites.map((site) => (
          <RecordCard key={site.id} label={site.name} onOpen={() => setOpenId(site.id)}>
            <span className={RECORD_NAME}>{site.name}</span>
            <span className="text-sm text-muted">
              {he.admin.siteManagers}:{" "}
              {site.managers.length === 0
                ? he.admin.noManagers
                : site.managers.map((manager) => manager.name).join(", ")}
            </span>
          </RecordCard>
        ))}
      </ul>

      {creating ? (
        <SiteCreateDialog managers={managers} onClose={() => setCreating(false)} />
      ) : null}

      {/*
       * ‏`key` על מזהה הרשומה — הדיאלוג מחזיק מצב טופס פנימי (מה נבחר,
       * מה מוקלד), וללא `key` מעבר מרשומה לרשומה **באותה עמדה** ב-DOM
       * היה משאיר את המצב של הקודמת. היום זה אינו קורה בפועל, מפני
       * שהכיסוי חוסם את הכרטיסים שמאחוריו — כלומר ההגנה היא על הנחה
       * שנכונה במקרה, וזה בדיוק סוג התלות שנשברת בשקט.
       */}
      {open ? (
        <SiteDetailsDialog
          key={open.id}
          site={open}
          managers={managers}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function SiteCreateDialog({
  managers,
  onClose,
}: {
  managers: ManagerOption[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { busy, error, run } = useAction();

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <Dialog title={he.admin.newSite} onClose={onClose}>
      <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>
        <Field label={he.admin.siteName}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="compact"
            disabled={busy}
          />
        </Field>

        <SiteManagersField
          managers={managers}
          selected={selected}
          onToggle={toggle}
          disabled={busy}
        />

        {error ? <FormError>{error}</FormError> : null}

        <div className="flex gap-2">
          <Button
            size="compact"
            disabled={busy || name.trim().length === 0}
            onClick={() =>
              run(() => createSiteAction({ name, managerIds: selected }), onClose)
            }
          >
            {he.admin.addSite}
          </Button>
          <Button variant="secondary" size="compact" onClick={onClose} disabled={busy}>
            {he.common.cancel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * פרטי האתר, ובהם כל מה שירד מהכרטיס.
 *
 * **המונים אינם קישוט:** הם מה שאומר למנהל, **לפני** שהוא לוחץ על פח
 * הזבל, אם המחיקה תיחסם ובמה. § מחיקה קובע שהכפתור נשאר לחיץ וההודעה
 * נוקבת בחוסם — המונים כאן הם אותו מידע, רק מוקדם יותר.
 */
function SiteDetailsDialog({
  site,
  managers,
  onClose,
}: {
  site: SiteRow;
  managers: ManagerOption[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(site.managers.map((manager) => manager.id));
  const { busy, error, run } = useAction();

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  const dirty =
    selected.length !== site.managers.length ||
    selected.some((id) => !site.managers.some((manager) => manager.id === id));

  return (
    <Dialog title={he.admin.siteDetails} onClose={onClose}>
      <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>
        {/*
         * השם והעיפרון בשורה אחת: העיפרון פועל **על השם** ולכן נצמד
         * אליו (§ Layout), ובלחיצה `InlineRename` פורש שדה ברוחב מלא.
         */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={RECORD_NAME}>{site.name}</span>
          <InlineRename value={site.name} action={renameSiteAction.bind(null, site.id)} />
        </div>

        <p className="text-sm text-muted">
          {he.admin.siteBuildingCount(site.buildingCount)} · {he.admin.linkedTickets(site.ticketCount)}
        </p>

        <SiteManagersField
          managers={managers}
          selected={selected}
          onToggle={toggle}
          disabled={busy}
          currentSiteId={site.id}
        />

        {error ? <FormError>{error}</FormError> : null}

        {/*
         * "שמור שיוך" מוצג רק כשיש מה לשמור. כפתור שמור שתמיד פעיל בתוך
         * פאנל פרטים קורא כאילו יש טופס לא-שמור, גם כשלא נגעו בכלום.
         */}
        {dirty ? (
          <Button
            size="compact"
            className="self-start"
            disabled={busy}
            onClick={() => run(() => setSiteManagersAction(site.id, selected))}
          >
            {he.common.save}
          </Button>
        ) : null}

        {/*
         * שורת המוצא: ניווט לבניינים, ומחיקה. שניהם פועלים על **האתר**
         * ולא על שדה בתוכו, ולכן הם בתחתית ולא לצד ערך מסוים.
         *
         * ‏`ButtonLink` ולא `Link` מעוצב — זו פעולה בשורה, ומחלקות טקסט
         * היו נותנות לה גובה של טקסט (§ שינוי שם בשורה).
         */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <ButtonLink href={`/admin/sites/${site.id}`} variant="secondary" size="compact">
            {he.admin.buildings}
          </ButtonLink>
          <DeleteButton name={site.name} action={deleteSiteAction.bind(null, site.id)} />
        </div>
      </div>
    </Dialog>
  );
}
