"use client";

import { Field } from "@/components/ui/field";
import { he } from "@/lib/he";
import { ROW_LIST } from "@/lib/ui";

export interface ManagerOption {
  id: string;
  name: string;
  siteId: string | null;
  siteName: string | null;
}

/**
 * בורר מנהלי העבודה של אתר — משותף לדיאלוג ההקמה ולדיאלוג הפרטים.
 *
 * **למה תיבות סימון ולא `<select multiple>`.** בורר מרובה נייטיב דורש
 * ‏Ctrl+לחיצה כדי לבחור יותר מאחד, ובטלפון הוא נפתח כרשימה שגובהה נקבע
 * בידי ה-UA. שתי ההתנהגויות אינן ניתנות ללימוד מהמסך, והרשימה כאן היא
 * ממילא קצרה — מנהלי העבודה של חברה אחת.
 *
 * **‏`siteName` מוצג לצד כל שם, וזה עיקר הרכיב.** ‏`User.siteId` הוא שדה
 * **יחיד**: מנהל עבודה שייך לאתר אחד, ולכן סימון מנהל שכבר משויך הוא
 * **העברה** — הוא ייעלם מהאתר הקודם. בלי החיווי הזה הפעולה שקטה, והמנהל
 * של האתר האחר מגלה זאת רק כשהפניות מפסיקות להגיע אליו.
 *
 * ‏`ROW_LIST` ולא `CARD_LIST`: אלה שורות **בתוך** פקד אחד, לא פריטים
 * נפרדים (§ ריתמוס).
 */
export function SiteManagersField({
  managers,
  selected,
  onToggle,
  disabled,
  /** האתר שנערך כרגע — מנהל שכבר בו אינו מוצג כ"עובר מ־" */
  currentSiteId,
}: {
  managers: ManagerOption[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  currentSiteId?: string;
}) {
  if (managers.length === 0) {
    return (
      <Field label={he.admin.siteManagers}>
        <p className="text-sm text-muted">{he.admin.noAssignableManagers}</p>
      </Field>
    );
  }

  return (
    /*
     * ‏`Field` עוטף ב-`<label>`, וקישור מרומז של תווית אחת לשמונה תיבות
     * סימון אינו אפשרי — ולכן כאן `<fieldset>`/`<legend>`, שזהו בדיוק
     * תפקידם: שם לקבוצת פקדים. הסגנון זהה ל-`field-label` שבתקן.
     */
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium">{he.admin.siteManagers}</legend>
      <ul className={ROW_LIST}>
        {managers.map((manager) => {
          const elsewhere = manager.siteId !== null && manager.siteId !== currentSiteId;

          return (
            <li key={manager.id}>
              <label className="flex min-h-7 items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(manager.id)}
                  onChange={() => onToggle(manager.id)}
                  disabled={disabled}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 truncate">{manager.name}</span>
                {/*
                 * החיווי מופיע רק כשהשיוך הנוכחי הוא **אתר אחר**. מנהל
                 * שכבר באתר הזה, או שאין לו אתר כלל, אינו עובר לשום מקום
                 * — והדגשת מצב שאינו שינוי היא בדיוק רעש.
                 */}
                {elsewhere ? (
                  <span className="shrink-0 text-xs text-muted">
                    {he.admin.managerCurrentSite(manager.siteName ?? "")}
                  </span>
                ) : null}
                {manager.siteId === null ? (
                  <span className="shrink-0 text-xs text-muted">{he.admin.managerNoSite}</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
