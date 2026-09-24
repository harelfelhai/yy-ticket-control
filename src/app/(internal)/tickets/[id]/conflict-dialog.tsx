"use client";

import { useId, useState } from "react";
import type { DraftFieldName } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/message";
import type { DraftFieldDisplay } from "@/lib/draft/display";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { DIALOG_SCROLL_BODY, DIALOG_WIDE, ROW_LIST } from "@/lib/ui";
import { resolveDraftConflictsAction } from "./actions";

/**
 * מסך 7א — סתירות בין המייל למערכת (אפיון 1.3).
 *
 * החלון מכריע, שדה אחר שדה, בין הערך שנקבע במערכת לבין הערך מהמייל
 * האחרון. דפוס האינטראקציה לקוח ממסך ההשוואה של EasyInv; העיצוב לא — ראה
 * DESIGN.md § חלון הסתירות.
 *
 * **DOM אחד לשני הרוחבים.** בדסקטופ טבלת השוואה של **כל** השדות (שורות
 * בסתירה עם בחירה, השאר לקריאה); בטלפון גוש לכל שדה בסתירה בלבד. אלה אותן
 * שורות עם `grid-cols` שונה, ולא שני עותקים: שני עותקים היו מכפילים את
 * כפתורי הרדיו, ושני רדיו באותו `name` שרק אחד מהם נראה הם בדיוק מה
 * ש-`getByRole("radio")` היה תופס.
 *
 * **אין בחירה מראש** (EM-S7A-04): החלון נפתח ואף ערך אינו מסומן, ו"החל את
 * הבחירה" פעיל רק אחרי שנבחר ערך בכל שדה שבסתירה. בחירה מראש הייתה הופכת
 * את הסתירה לאישור בלחיצה אחת בלי להסתכל.
 *
 * **"סגור" הוא כפתור ה-X של הדיאלוג** (השם הנגיש `he.common.close`), וסגירה
 * אינה משנה דבר — הסתירות נשארות (EM-S7A-05).
 */

type Choice = "system" | "email";
type Choices = Partial<Record<DraftFieldName, Choice>>;

interface ConflictDialogProps {
  ticketId: string;
  /** כל שדות הטיוטה, בסדר `DRAFT_FIELDS` — לא רק אלה שבסתירה */
  fields: DraftFieldDisplay[];
  /** `conflictsVersion` של מה שמוצג; השרת דוחה הכרעה על ערכים שהשתנו בינתיים */
  version: string;
  /**
   * האם הצופה רשאי לבחור את האתר שהמייל הציע. מנהל עבודה אינו יכול להוציא
   * טיוטה מהאתר שלו (`canCreateTicketInSite`), והשרת היה דוחה בחירה כזו
   * ב"אין הרשאה" כללי — לכן האפשרות מושבתת עם הסבר עוד לפני הלחיצה.
   */
  emailSiteAllowed?: boolean;
  /**
   * הכפתור מושבת — ה-`busy` של מסך 7 (`useAction`): עד ה-hydration, שבלעדיו
   * לחיצה נבלעת בשקט, ובזמן ששמירה בטופס בדרך ועומדת לרענן את הערכים.
   */
  disabled?: boolean;
}

/** שלוש העמודות בדסקטופ: שם השדה, במערכת, מהמייל */
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]";

/** ערך בתא: תיאור רב-שורות שומר על השורות, וקישור ארוך נשבר ואינו גולש לעמודה השכנה */
const VALUE = "min-w-0 whitespace-pre-wrap wrap-break-word";

export function ConflictDialog({ disabled = false, ...props }: ConflictDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="compact" disabled={disabled} onClick={() => setOpen(true)}>
        {he.emailDraft.compare}
      </Button>
      {/*
       * הפאנל הוא רכיב נפרד שנטען מחדש בכל פתיחה: כך הבחירות מתאפסות
       * בין פתיחה לפתיחה, ו"אין בחירה מראש" נכון גם בפעם השנייה.
       */}
      {open ? <ConflictPanel {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ConflictPanel({
  ticketId,
  fields,
  version,
  emailSiteAllowed = true,
  onClose,
}: ConflictDialogProps & { onClose: () => void }) {
  /*
   * **מה שהוצג בפתיחה — קפוא.** רענון של העמוד יכול להגיע בזמן שהחלון פתוח
   * (שמירה אחרת בטופס, תשובה חדשה במייל), ואם הערכים והגרסה היו מתחלפים
   * מתחת לבחירות שכבר סומנו, השרת היה מקבל הכרעה על ערכים שאיש לא ראה —
   * בדיוק מה ש-§7 שורה 84 אוסר. כשהם קפואים, השרת דוחה והמשתמש פותח מחדש.
   */
  const [shown] = useState(() => ({ fields, version }));
  const [choices, setChoices] = useState<Choices>({});
  const { busy, error, run } = useAction();

  const conflicts = shown.fields.filter((field) => field.conflict);
  const complete = conflicts.every((field) => choices[field.field] !== undefined);

  function apply() {
    run(() => resolveDraftConflictsAction(ticketId, choices, shown.version), onClose);
  }

  return (
    // סגירה בזמן שההכרעה בדרך הייתה מעלימה את התשובה שלה — גם שגיאה
    <Dialog
      title={he.emailDraft.conflictsTitle}
      width={DIALOG_WIDE}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>
        {/*
         * כותרות העמודות — בדסקטופ בלבד, ו-`aria-hidden`: כל אפשרות נושאת
         * את שם המקור שלה בשם הנגיש (`md:sr-only`), כך שהכותרות הן חזותיות.
         */}
        <div
          aria-hidden="true"
          className={`hidden md:grid ${COLUMNS} gap-x-3 px-3 text-sm font-semibold text-muted`}
        >
          <span>{he.emailDraft.columnField}</span>
          <span>{he.emailDraft.columnSystem}</span>
          <span>{he.emailDraft.columnEmail}</span>
        </div>

        <ul className={ROW_LIST}>
          {shown.fields.map((field) =>
            field.conflict ? (
              <ConflictRow
                key={field.field}
                field={field}
                choice={choices[field.field]}
                disabled={busy}
                emailAllowed={field.field !== "SITE" || emailSiteAllowed}
                onChoose={(choice) => setChoices((prev) => ({ ...prev, [field.field]: choice }))}
              />
            ) : (
              <ReadOnlyRow key={field.field} field={field} />
            ),
          )}
        </ul>

        {error ? <FormError>{error}</FormError> : null}

        {/*
         * הכפתור מושבת ואינו מסביר בלחיצה (כמו "שגר" בזמן סתירה), ולכן ההסבר
         * יושב לצדו כל עוד הוא מושבת.
         */}
        {complete ? null : <p className="text-xs text-muted">{he.emailDraft.chooseEverywhere}</p>}
        <div className="flex gap-2">
          <Button onClick={apply} disabled={busy || !complete}>
            {he.emailDraft.applyChoices}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * שורה בסתירה: שם השדה ושתי אפשרויות, כל אחת רדיו + הערך. בדסקטופ שלוש
 * עמודות; בטלפון עמודה אחת — שם השדה ומתחתיו האפשרויות זו מעל זו.
 *
 * **`role="group"` עם `aria-labelledby`, ולא `<fieldset>`/`<legend>`:** `<legend>`
 * מרונדר אינו פריט גריד, ולכן לא היה משתתף בעמודות שה-DOM האחד לשני
 * הרוחבים נשען עליהן. לטכנולוגיה מסייעת שתי הצורות שקולות.
 */
function ConflictRow({
  field,
  choice,
  disabled,
  emailAllowed,
  onChoose,
}: {
  field: DraftFieldDisplay;
  choice: Choice | undefined;
  disabled: boolean;
  emailAllowed: boolean;
  onChoose: (choice: Choice) => void;
}) {
  const labelId = useId();
  const name = `conflict-${field.field}`;

  return (
    <li>
      <div
        role="group"
        aria-labelledby={labelId}
        className={`grid min-h-8 grid-cols-1 items-center gap-x-3 gap-y-1 border-s-2 border-s-danger px-3 py-1 ${COLUMNS}`}
      >
        <span id={labelId} className="text-sm font-medium">
          {field.label}
        </span>
        <ChoiceOption
          name={name}
          value="system"
          source={he.emailDraft.columnSystem}
          text={field.systemText}
          checked={choice === "system"}
          disabled={disabled}
          onChoose={onChoose}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <ChoiceOption
            name={name}
            value="email"
            source={he.emailDraft.columnEmail}
            text={field.emailText ?? he.emailIntake.empty}
            checked={choice === "email"}
            disabled={disabled || !emailAllowed}
            onChoose={onChoose}
          />
          {emailAllowed ? null : <p className="text-xs text-muted">{he.emailDraft.emailSiteNotAllowed}</p>}
        </div>
      </div>
    </li>
  );
}

function ChoiceOption({
  name,
  value,
  source,
  text,
  checked,
  disabled,
  onChoose,
}: {
  name: string;
  value: Choice;
  source: string;
  text: string;
  checked: boolean;
  disabled: boolean;
  onChoose: (choice: Choice) => void;
}) {
  return (
    <label className="flex min-h-7 min-w-0 items-center gap-2 text-base">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChoose(value)}
        className="size-4 shrink-0"
      />
      <span className={VALUE}>
        {/*
         * שם המקור: גלוי בטלפון (אין שם כותרות עמודה), ובדסקטופ `sr-only` —
         * מוסתר מהעין, שרואה את כותרת העמודה, אבל נשאר בשם הנגיש של הרדיו.
         * `md:hidden` היה מוציא אותו גם מהשם הנגיש, והמקור היה נמסר רק במיקום.
         */}
        <span className="text-xs text-muted md:sr-only">{source}:</span> {text}
      </span>
    </label>
  );
}

/**
 * שדה שאינו בסתירה — לקריאה בלבד, ובדסקטופ בלבד (בטלפון הוא גלוי במסך 7
 * שמאחור).
 *
 * **עמודת "מהמייל" מלאה רק כשהערך ידוע.** בשדה שערכו הגיע מהמייל (`fromEmail`)
 * הערך במערכת **הוא** הערך מהמייל, והוא מוצג בשתי העמודות: תא ריק תחת
 * "מהמייל" היה נקרא "המייל לא נתן כלום", דווקא בשדה שכולו מהמייל. בשדה
 * שנערך במערכת התא ריק: ערך מהמייל נשמר רק בסתירה, ו"—" היה טוען שלמייל
 * לא היה ערך — דבר שאיננו יודעים.
 */
function ReadOnlyRow({ field }: { field: DraftFieldDisplay }) {
  return (
    <li className={`hidden md:grid ${COLUMNS} min-h-8 items-center gap-x-3 px-3 py-1 text-sm text-muted`}>
      <span>{field.label}</span>
      <span className={VALUE}>{field.systemText}</span>
      <span className={VALUE}>{field.fromEmail ? field.systemText : null}</span>
    </li>
  );
}
