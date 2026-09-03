"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { LearnedSelect, type LearnedOption } from "./learned-select";
import { ProfessionalCreateForm } from "./professional-create-form";
import { chipClasses } from "@/components/ui/chip";

export interface RecipientOption extends LearnedOption {
  kind: "professional" | "user";
  /**
   * לנמען הזה אין מייל, ולכן המערכת לא תיידע אותו — רק וואטסאפ ידני
   * (אפיון §5.ה2).
   *
   * **הדגל נחוץ בלקוח ולא רק בשרת**, מפני שהחלטה אחת חייבת להתקבל *לפני*
   * הקריאה לשרת: האם לפתוח לשונית. ‏`window.open` מותר רק בתוך אירוע
   * הלחיצה, ובלי הדגל היינו פותחים לשונית ריקה בכל שיגור וסוגרים אותה
   * כשמתברר שאין צורך — הבהוב שנראה בכל פנייה, גם כשלכולם יש מייל.
   *
   * ‏`hint` אינו תחליף: הוא מציג טלפון **או** מייל, ולכן קבלן שיש לו
   * שניהם נראה בו זהה לקבלן שיש לו טלפון בלבד.
   */
  needsWhatsApp?: boolean;
}

interface RecipientPickerProps {
  options: RecipientOption[];
  value: RecipientOption[];
  onChange: (recipients: RecipientOption[]) => void;
  onCreateProfessional: (input: {
    name: string;
    phone: string;
    email: string;
  }) => Promise<RecipientOption>;
}

/**
 * בורר הנמענים (מסך 3 באפיון), בשימוש גם ביצירת פנייה וגם בעריכת נמענים.
 *
 * שיוך מרובה הוא ליבת המערכת: אותה תקלה עשויה לדרוש חשמלאי ואינסטלטור,
 * ולכל אחד מהם סטטוס משלו. לכן הנמענים מוצגים כרשימת צ׳יפים הניתנת להסרה
 * ולא כשדה יחיד.
 *
 * יצירת איש מקצוע חדש היא טופס נפרד ולא שורת "צור חדש" בתוך הרשימה, כי
 * איש מקצוע דורש גם טלפון או מייל — בלעדיהם אי אפשר לשגר אליו כלל.
 */
export function RecipientPicker({
  options,
  value,
  onChange,
  onCreateProfessional,
}: RecipientPickerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const hydrated = useHydrated();
  const busy = !hydrated;

  const selectedIds = new Set(value.map((r) => `${r.kind}:${r.id}`));
  const available = options.filter((o) => !selectedIds.has(`${o.kind}:${o.id}`));

  function add(id: string | null) {
    const option = options.find((o) => o.id === id);
    if (option) onChange([...value, option]);
  }

  function remove(recipient: RecipientOption) {
    onChange(value.filter((r) => !(r.id === recipient.id && r.kind === recipient.kind)));
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <ul aria-label={he.ticket.recipients} className="flex flex-wrap gap-2">
          {value.map((recipient) => (
            <li key={`${recipient.kind}:${recipient.id}`}>
              <span className={chipClasses("brand", "solid", "large")}>
                {recipient.label}
                {/*
                  ‏28px של אזור לחיצה סביב סמל שנשאר קטן — בדיוק הכלל
                  ב-DESIGN.md § אזורי מגע: "כשהיעד הטבעי קטן מהגובה הזה
                  (אייקון, קישור בשורה) — מרחיבים את אזור הלחיצה, לא את הסמל".
                  עד 1.9.2026 עמד כאן `px-1` בלבד, כלומר יעד של כ-16px —
                  מתחת לרצפה שהמסמך קובע **לכל מכשיר**, ולא רק למגע.

                  המרווחים השליליים הם מה שמאפשר את זה בלי להשמין את הצ׳יפ:
                  `-my-1` ו-`-me-2` מבטלים את הריפוד של הצ׳יפ (`px-2 py-1`),
                  כך שהכפתור נמתח עד קצוותיו ונשאר 28px — והצ׳יפ עצמו נשאר
                  בגובהו. הרחבת הסמל במקום אזור הלחיצה הייתה משנה את המראה.
                */}
                <button
                  type="button"
                  onClick={() => remove(recipient)}
                  aria-label={`${he.ticket.removeRecipient} ${recipient.label}`}
                  className="-my-1 -me-2 inline-flex min-h-7 min-w-7 items-center justify-center text-base leading-none"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <LearnedSelect
        label={he.ticket.recipients}
        options={available}
        value={null}
        onChange={add}
        placeholder={he.ticket.addRecipient}
      />

      {showCreate ? (
        <ProfessionalCreateForm
          onCreate={async (input) => {
            const created = await onCreateProfessional(input);
            onChange([...value, created]);
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      ) : (
        <Button
          variant="quiet"
          size="compact"
          disabled={busy}
          onClick={() => setShowCreate(true)}
          className="self-start px-1 text-start"
        >
          {he.directory.newProfessional}
        </Button>
      )}
    </div>
  );
}
