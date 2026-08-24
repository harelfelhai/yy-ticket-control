"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  FilterBar,
  FilterDate,
  FilterSelect,
} from "@/components/ui/filter-bar";
import { he } from "@/lib/he";
import type { DerivedTicketStatus } from "@/lib/ticket-status";

interface Option {
  id: string;
  name: string;
}

interface BoardFiltersProps {
  sites: Option[];
  buildings: Option[];
  /** דירות הבניין שנבחר — ריק כשלא נבחר בניין */
  apartments: Option[];
  domains: Option[];
  recipients: Option[];
  tags: Option[];
}

/**
 * הפרמטרים שנחשבים סינון. `view` ו-`focus` הם מצב תצוגה ולא נספרים כאן.
 *
 * ‏`q` אינו ברשימה בכוונה: הוא **מונח החיפוש ולא מסנן**, ו"נקה מסננים"
 * שהיה מוחק אותו היה מוחק את מה שהמשתמש הקליד. ההבחנה הזו הגיעה מהמסך
 * שהיה נפרד, והיא נשארת נכונה גם אחרי שהוא אוחד לכאן.
 */
const FILTER_PARAMS = [
  "direction",
  "site",
  "building",
  "apartment",
  "domain",
  "recipient",
  "tag",
  "status",
  "from",
  "to",
];

/**
 * הסטטוסים שניתן לסנן לפיהם, בסדר מחזור החיים ולא בסדר ה-enum: מנהל סורק
 * את הרשימה כדי למצוא מצב, לא כדי לקרוא אותה מהתחלה.
 */
const STATUS_OPTIONS: DerivedTicketStatus[] = [
  "NEW",
  "VIEWED",
  "PARTIAL",
  "AWAITING_OPENER_APPROVAL",
  "CLOSED",
  "DRAFT",
];

/**
 * רצועת המסננים של הלוח.
 *
 * המצב נשמר ב-URL ולא ב-state מקומי, משלוש סיבות מעשיות: כניסה חוזרת
 * למסך אחרי צפייה בפנייה משמרת את התצוגה, אפשר לשלוח קישור למסונן, וכפתור
 * "אחורה" בדפדפן עובד כמצופה. המחיר הוא סבב שרת לכל שינוי — זניח מול
 * המחיר של מנהל שמאבד את הסינון בכל לחיצה.
 */
export function BoardFilters({
  sites,
  buildings,
  apartments,
  domains,
  recipients,
  tags,
}: BoardFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /**
   * מקבל זוגות ולא מפתח יחיד: "נקה מסננים" מאפס שישה מהם בבת אחת, וקריאה
   * לכל אחד בנפרד הייתה מייצרת שישה ניווטים — וגם מוחקת בדרך את `q`, כי
   * כל קריאה נשענת על `params` שכבר אינו מעודכן.
   */
  function update(pairs: [string, string][]) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of pairs) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  /**
   * ‏defaultValue יחד עם key, ולא value מבוקר.
   *
   * הפקדים נשלטים על ידי ה-URL, והניווט אינו מיידי. פקד מבוקר היה נשאר
   * במצב הישן עד שהשרת מחזיר תשובה — המשתמש בוחר בניין ורואה את הבורר
   * חוזר לערך הקודם. עם defaultValue הדפדפן משנה את המצב מיד, וה-key
   * מאלץ סנכרון מחדש כשהכתובת באמת מתעדכנת (למשל בלחיצה על "נקה מסננים").
   */
  const syncKey = params.toString();

  const table = params.get("view") === "table";
  const activeCount = FILTER_PARAMS.filter((key) => params.get(key)).length;

  return (
    /*
     * שתי שורות ולא אחת: חיפוש מעל, מסננים מתחת.
     *
     * ‏`gap-2` ולא `gap-3` — שתי השורות הן אזור אחד של פקדים מעל הלוח,
     * ורווח גדול מדי היה מפריד ביניהן לשני בלוקים שאינם קשורים.
     */
    <div className="flex flex-col gap-2">
      <BoardSearch />
      <FilterBar
        trailing={
          <>
            {/*
             * מתג התצוגה (0.3). **מוסתר מתחת ל-`md`**: טבלה ברוחב 390px היא
             * גלישה אופקית או טקסט קטוע, ומשתמש נייד שלוחץ ולא רואה שינוי
             * לומד שהמערכת לא מגיבה.
             *
             * ‏`view` אינו מסנן ולכן הוא ב-`trailing` ואינו מתקפל לתוך
             * הרצועה — "מה שאינו מסנן אינו מתקפל" (§ FilterBar).
             */}
            <Button
              variant="secondary"
              size="compact"
              className="hidden md:inline-flex"
              onClick={() => update([["view", table ? "" : "table"]])}
            >
              {table ? he.board.viewCards : he.board.viewTable}
            </Button>

            {activeCount > 0 ? (
              <Button
                variant="quiet"
                size="compact"
                className="shrink-0"
                onClick={() => update(FILTER_PARAMS.map((key) => [key, ""]))}
              >
                {he.board.clearFilters}
              </Button>
            ) : null}
          </>
        }
      >
        {/* בורר האתר מוצג רק למי שרואה יותר מאחד (בעלים, מנהל מערכת). מנהל
          עבודה מקובע לאתרו, ואין לו מה לסנן. */}
        {sites.length > 1 ? (
          <FilterSelect
            key={`site-${syncKey}`}
            aria-label={he.ticket.site}
            defaultValue={params.get("site") ?? ""}
            onChange={(e) => update([["site", e.target.value]])}
          >
            <option value="">{he.board.allSites}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </FilterSelect>
        ) : null}

        <FilterSelect
          key={`direction-${syncKey}`}
          aria-label={he.board.opened}
          defaultValue={params.get("direction") ?? ""}
          onChange={(e) => update([["direction", e.target.value]])}
        >
          <option value="">{he.board.allDirections}</option>
          <option value="opened">{he.board.opened}</option>
          <option value="received">{he.board.received}</option>
        </FilterSelect>

        <FilterSelect
          key={`building-${syncKey}`}
          aria-label={he.directory.building}
          defaultValue={params.get("building") ?? ""}
          // החלפת בניין מאפסת את הדירה: דירה 7 בבניין א׳ אינה דירה 7 בבניין ב׳,
          // ומזהה שנשאר מהבחירה הקודמת היה מרוקן את הלוח בלי הסבר.
          onChange={(e) =>
            update([
              ["building", e.target.value],
              ["apartment", ""],
            ])
          }
        >
          <option value="">{he.board.allBuildings}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </FilterSelect>

        {/*
        בורר הדירה מופיע **רק אחרי בחירת בניין**, וזה גם הסדר שבו מנהל עבודה
        חושב: קודם איפה, אחר כך איזו. בורר שמציג את כל הדירות בכל האתרים הוא
        רשימה של מאות פריטים בלי הקשר.
      */}
        {apartments.length > 0 ? (
          <FilterSelect
            key={`apartment-${syncKey}`}
            aria-label={he.directory.apartment}
            defaultValue={params.get("apartment") ?? ""}
            onChange={(e) => update([["apartment", e.target.value]])}
          >
            <option value="">{he.search.allApartments}</option>
            {apartments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </FilterSelect>
        ) : null}

        <FilterSelect
          key={`domain-${syncKey}`}
          aria-label={he.directory.domain}
          defaultValue={params.get("domain") ?? ""}
          onChange={(e) => update([["domain", e.target.value]])}
        >
          <option value="">{he.board.allDomains}</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          key={`recipient-${syncKey}`}
          aria-label={he.directory.professional}
          defaultValue={params.get("recipient") ?? ""}
          onChange={(e) => update([["recipient", e.target.value]])}
        >
          <option value="">{he.board.allRecipients}</option>
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </FilterSelect>

        {/* מסנן התגית מוצג רק כשיש תגיות: מסך ריק של בורר בלי אפשרויות הוא
          רעש למי שעדיין לא התחיל לתייג. */}
        {tags.length > 0 ? (
          <FilterSelect
            key={`tag-${syncKey}`}
            aria-label={he.tag.label}
            defaultValue={params.get("tag") ?? ""}
            onChange={(e) => update([["tag", e.target.value]])}
          >
            <option value="">{he.board.allTags}</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </FilterSelect>
        ) : null}

        <FilterSelect
          key={`status-${syncKey}`}
          aria-label={he.search.allStatuses}
          defaultValue={params.get("status") ?? ""}
          onChange={(e) => update([["status", e.target.value]])}
        >
          <option value="">{he.search.allStatuses}</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {he.ticketStatus[status]}
            </option>
          ))}
        </FilterSelect>

        <FilterDate
          key={`from-${syncKey}`}
          label={he.search.from}
          defaultValue={params.get("from") ?? ""}
          onChange={(e) => update([["from", e.target.value]])}
        />
        <FilterDate
          key={`to-${syncKey}`}
          label={he.search.to}
          defaultValue={params.get("to") ?? ""}
          onChange={(e) => update([["to", e.target.value]])}
        />
      </FilterBar>
    </div>
  );
}

/**
 * שורת החיפוש של הלוח (0.6) — שורה משל עצמה מעל רצועת המסננים.
 *
 * **היא אינה פריט ברצועה, וזה מכוון.** ראו את הנימוק המלא ב-`FilterBar`:
 * מסנן מצמצם את הלוח וחיפוש מחליף אותו, ובנוסף — 334px בתוך רצועה של עשרה
 * פקדים דחפו את מסנן התאריך אל מחוץ למסך.
 *
 * **הגובה כאן `default` ולא `compact`**, בשונה מכל פקד אחר בסבב הצפיפות.
 * הצפיפות נועדה להחזיר שטח לתוכן, לא להשטיח היררכיה: זהו הפקד היחיד בעמוד
 * שמחליף את כל תוכנו, והוא נקרא ראשון. ארבעה פיקסלים הם ההפרש בין "שדה
 * ברצועה" ל"שורת החיפוש של המסך".
 *
 * **טופס עם שיגור מפורש, ולא חיפוש-תוך-כדי-הקלדה.** כל הקשה הייתה מפעילה
 * שאילתה שחוצה ארבעה מקורות טקסט — תיאור, הודעות, תמלול וטקסט שחולץ —
 * ובלי אינדקסי trigram (נמחקו במיגרציה ולא שוחזרו) זו סריקה סדרתית. מנהל
 * עבודה מקליד את זה על רשת סלולרית באתר בנייה. ההחלטה הזו נשמרה מהמסך
 * הנפרד שהיה, יחד עם הנימוק שלה.
 *
 * **הסנכרון ל-URL נעשה ברינדור ולא ב-`useEffect`.** הטקסט שבשדה חייב לעקוב
 * אחרי הכתובת — "אחורה" בדפדפן שמחזיר תוצאות קודמות חייב להחזיר גם את מה
 * שכתוב בשדה, אחרת המשתמש רואה תוצאות שאינן תואמות למה שלפניו. `useEffect`
 * היה מרנדר פעם אחת עם הערך הישן ואז מתקן, כלומר הבהוב; התבנית כאן היא זו
 * ש-React ממליץ עליה לאיפוס state לפי prop, והיא גם מה שהלינטר אוכף.
 */
function BoardSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("q") ?? "";
  const [query, setQuery] = useState(current);
  const [synced, setSynced] = useState(current);

  if (synced !== current) {
    setSynced(current);
    setQuery(current);
  }

  return (
    <form
      // חסם רוחב ולא רוחב מלא: במסך של 1600px שדה חיפוש נמתח הוא 1560px של
      // ריק שנקרא כשגיאת פריסה, וגם התוכן שמוקלד בו מתחיל רחוק מהתווית.
      // ‏576px מחזיקים משפט חיפוש שלם ועדיין נראים כשדה.
      //
      // ‏`max-w-144` המספרי ולא `max-w-xl` בשם: זהו **אילוץ פקד** ולא רוחב
      // תוכן, אותה משפחה כמו `max-w-44` של `FilterSelect`. רוחב תוכן מגיע
      // מ-`src/lib/ui.ts` בלבד, ושם יש שני ערכים בלבד — `tests/unit/
      // layout-guards.test.ts` אוכף בדיוק את הגבול הזה.
      className="flex w-full max-w-144 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = new URLSearchParams(params.toString());
        const value = query.trim();
        if (value) next.set("q", value);
        else next.delete("q");
        // ‏`focus` הוא צלילה ממדד בסקירה, והוא סותר חיפוש: שניהם מחליפים
        // את תוכן המסך, והשארתו הייתה מציגה תוצאות מסוננות פעמיים.
        next.delete("focus");
        const search = next.toString();
        router.replace(search ? `${pathname}?${search}` : pathname);
      }}
    >
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={he.common.search}
        placeholder={he.board.searchPlaceholder}
        className="min-w-0 flex-1"
      />
      <Button type="submit" variant="secondary" className="shrink-0">
        {he.search.submit}
      </Button>
    </form>
  );
}
