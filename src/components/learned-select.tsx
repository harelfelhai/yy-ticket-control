"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cardClasses } from "@/components/ui/card";
import { Input, controlClasses } from "@/components/ui/field";
import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import { normalizeName } from "@/lib/normalize";
import type { SelectOption } from "@/lib/options";
import { useHydrated } from "@/lib/use-hydrated";

export type LearnedOption = SelectOption;

interface LearnedSelectProps {
  label: string;
  options: LearnedOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** ללא הפרופ הזה הרשימה סגורה ואי אפשר להוסיף אליה ערכים */
  onCreate?: (name: string) => Promise<LearnedOption>;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * בורר לרשימה נלמדת: בחירה מתוך הקיים, ויצירת ערך חדש כפעולה נפרדת ומכוונת.
 *
 * זו ההגנה השלישית מול כפילויות (שתי הראשונות הן נרמול ו-upsert בשרת).
 * האפיון דורש במפורש "רשימת בחירה קצרה של הערכים הקיימים, לא שדה טקסט" —
 * כי בשדה טקסט חופשי כל שגיאת הקלדה יוצרת בניין חדש, וההפרדה בין "בניין א"
 * ל-"בניין א'" מפצלת דוחות ותגיות בלי שאיש שם לב.
 *
 * לכן: המסלול הקל הוא בחירה בקיים. יצירה דורשת לחיצה על שורה שכתוב בה
 * במפורש `צור חדש: "..."`.
 */
export function LearnedSelect({
  label,
  options,
  value,
  onChange,
  onCreate,
  placeholder,
  disabled,
}: LearnedSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();
  const listId = useId();
  const labelId = `${listId}-label`;
  const valueId = `${listId}-value`;
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;
  const trimmedQuery = normalizeName(query);

  const filtered = useMemo(() => {
    if (!trimmedQuery) return options;
    return options.filter((o) => o.label.includes(trimmedQuery));
  }, [options, trimmedQuery]);

  // מציעים יצירה רק כשאין התאמה מדויקת. הצעה לצד ערך זהה קיים היא בדיוק
  // הרגע שבו נוצרת הכפילות.
  const exactMatch = options.some((o) => normalizeName(o.label) === trimmedQuery);
  const canCreate = Boolean(onCreate) && trimmedQuery.length > 0 && !exactMatch;

  function close() {
    setOpen(false);
    setQuery("");
    setError(null);
  }

  async function handleCreate() {
    if (!onCreate || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await onCreate(trimmedQuery);
      onChange(created.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : he.common.genericError);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>

      <button
        type="button"
        // מושבת עד ל-hydration: בלי זה לחיצה מוקדמת נבלעת בשקט.
        disabled={disabled || !hydrated}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        // השם הנגיש מורכב מהתווית ומהערך הנבחר. בלי זה הכפתור נקרא "בחר"
        // בלבד, וגם קורא מסך וגם בדיקה אוטומטית אינם יודעים איזה שדה זה.
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => {
          setOpen((v) => !v);
          // מיקוד מושהה: הפאנל עדיין לא ב-DOM ברגע הלחיצה.
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
        /*
         * `controlClasses` ולא מחלקות ידניות: הכפתור הזה נראה כמו `<select>`
         * ולכן הוא חייב **להיות** אחד. לפני האיחוד הוא הרכיב את עצמו מחדש —
         * ועם `disabled:opacity-50` במקום 60, בפקד השכיח ביותר במערכת.
         *
         * `control-chevron` הוא אותו חץ בדיוק שעל ה-`<select>` הנייטיב.
         */
        className={controlClasses("default", false, "control-chevron flex items-center text-start")}
      >
        <span id={valueId} className={selected ? "" : "text-muted"}>
          {selected?.label ?? placeholder ?? he.common.choose}
        </span>
      </button>

      {open ? (
        // ‏`cardClasses` ולא מסגרת ורקע שנכתבים כאן: הפאנל הצף הוא משטח
        // ‏— אותו משטח בדיוק של כרטיס — והכתיבה הידנית היא מה שהשאיר אותו
        // ‏על עיגול 12px אחרי שהכרטיסים ירדו ל-6px. `compact` כי מה שבתוכו
        // ‏הוא רשימת שורות ולא תוכן כרטיס.
        <div className={cardClasses(undefined, { padding: "compact" })}>
          <Input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={he.common.search}
            aria-label={`${he.common.search} ${label}`}
            size="compact"
            className="mb-2"
          />

          <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
            {filtered.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  onClick={() => {
                    onChange(option.id);
                    close();
                  }}
                  /*
                   * שורת אפשרות היא **פקד**: אותו עיגול (4px), אותו ריפוד
                   * ואותו גובה של פקד קומפקטי. קודם היא נעלה 44px, כלומר
                   * רשימה של שמונה בניינים דרשה גלילה במקום שבה כולם נכנסים.
                   *
                   * המילוי הגרפיטי שמור ל**נבחר** ולו בלבד — זהו הסימן היחיד
                   * בפאנל שאינו טקסט, ולכן אסור לו להתחלק עם שורה אחרת.
                   */
                  className={`flex min-h-7 w-full flex-col justify-center rounded-sm px-2 text-start ${
                    option.id === value ? "bg-brand text-brand-fg" : ""
                  }`}
                >
                  <span>{option.label}</span>
                  {option.hint ? (
                    <span
                      dir="ltr"
                      className={`text-xs ${option.id === value ? "opacity-80" : "text-muted"}`}
                    >
                      {option.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}

            {/*
             * ‏`filtered` ריק ו-`canCreate` כבוי פירושו בפועל **רשימה ריקה בלי
             * חיפוש** — שורת "צור חדש" דורשת טקסט בשדה, ולכן היא עדיין אינה
             * קיימת. זה בדיוק המסך שדווח מהשטח כ"אין איפה להגדיר בניינים":
             * "אין תוצאות" לבדו קורא כמבוי סתום, בעוד שהמסלול פתוח לגמרי.
             *
             * ‏`px-2` כמו שורת אפשרות — הודעה שאינה מיושרת עם הרשימה שהיא
             * מדברת עליה נקראת כטקסט שנפל לתוך הפאנל.
             */}
            {filtered.length === 0 && !canCreate ? (
              <li className="px-2 py-2 text-sm text-muted">
                {onCreate ? he.directory.emptyListHint : he.common.noResults}
              </li>
            ) : null}
          </ul>

          {canCreate ? (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              /*
               * "צור חדש" — **הצורה נושאת את ההזמנה, לא הצבע.**
               *
               * עד המעבר לגרפיט השורה הייתה `border-brand` + `text-brand`,
               * כלומר מסגרת ומילה בכחול המותג. בפלטה הנוכחית `text-brand`
               * הוא בפועל צבע הטקסט הרגיל (ניגודיות 1.26 מול טקסט גוף) —
               * כלומר השורה הייתה הופכת לטקסט אפור בתוך רשימת אפשרויות,
               * ודווקא הפעולה שהאפיון דורש שתהיה **מכוונת ומפורשת**.
               *
               * המסגרת המקווקוות היא מה שנשאר, והיא מספיקה: קו מקווקו אינו
               * מופיע בשום מקום אחר במערכת, ולכן הוא קורא כ"כאן מוסיפים".
               * זהו בדיוק הנימוק של `LINK` — סימן שאינו תלוי בצבע — ולכן
               * גם אין כאן טוקן מצב: יצירת ערך אינה שגיאה, אינה אזהרה
               * ואינה מצב של פנייה.
               *
               * המילוי הגרפיטי לא בא בחשבון: הוא כבר מסמן את האפשרות
               * הנבחרת שלוש שורות מעל.
               */
              className="mt-1 min-h-7 w-full rounded-sm border border-dashed border-fg px-2 text-start font-medium disabled:opacity-60"
            >
              {he.directory.createNew(trimmedQuery)}
            </button>
          ) : null}

          {error ? (
            <FormError className="mt-2 px-1">{error}</FormError>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
