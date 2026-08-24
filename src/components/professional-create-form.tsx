"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * טופס יצירת איש מקצוע חדש — שם, טלפון ומייל.
 *
 * מחולץ לשימוש חוזר: הוא נחוץ גם ביצירת פנייה (`RecipientPicker`) וגם
 * בעריכת נמענים בפנייה קיימת (`RecipientEditor`), ומקור אמת אחד לכללי
 * השדות ("טלפון או מייל — חובה") מונע שתי גרסאות שרק אחת מהן מתוקנת.
 *
 * `onCreate` מקבל את הקלט ואחראי על כל מה שקורה בהצלחה (קריאת השרת, עדכון
 * המצב). הוא זורק שגיאה מוסברת בעברית, והטופס מציג אותה במקום.
 */
export interface ProfessionalDraft {
  name: string;
  phone: string;
  email: string;
}

interface ProfessionalCreateFormProps {
  onCreate: (input: ProfessionalDraft) => Promise<void>;
  onCancel: () => void;
}

export function ProfessionalCreateForm({ onCreate, onCancel }: ProfessionalCreateFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hydrated = useHydrated();
  const busy = saving || !hydrated;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onCreate({ name, phone, email });
    } catch (e) {
      setError(e instanceof Error ? e.message : he.common.genericError);
    } finally {
      setSaving(false);
    }
  }

  return (
    /*
     * ‏`cardClasses` ולא מסגרת, רקע, עיגול וריפוד שנכתבים כאן.
     *
     * מה שישב כאן — `rounded-xl border border-border bg-surface p-3` — היה
     * הכרטיס במילים אחרות, ולכן הוא **פספס את סבב הצפיפות** ונשאר על עיגול
     * ‏12px אחרי שהכרטיסים ירדו ל-6px. אותו סיפור בדיוק של `Dialog`: עותק
     * אינו יורש.
     *
     * scroll-mb-32: כשהטופס נפתח בתוך מסך עם רצועת פעולות דביקה בתחתית
     * (מסך היצירה), הריפוד-לגלילה מוודא שכפתור השמירה נגלל מעל הרצועה
     * ולא נחסם מאחוריה. זו פריסה ולא גיאומטריה, ולכן היא נשארת כאן.
     */
    <div className={cardClasses("flex scroll-mb-32 flex-col gap-2")}>
      <Field label={he.directory.professionalName}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label={he.directory.phone}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            inputMode="tel"
          />
        </Field>
        {/* הכלל מוצג מראש ולא רק ככשל, כי בלי אחד מהשניים אי אפשר לשגר כלל.
            הוא נתלה בשדה המייל — האחרון מבין השניים — כדי שייקרא אחריהם. */}
        <Field label={he.directory.email} hint={he.directory.contactRequiredHint}>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
            inputMode="email"
          />
        </Field>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <div className="flex gap-2">
        <Button
          onClick={submit}
          disabled={busy}
          size="compact"
          // scroll-mb-32: הכפתור הוא זה שנגלל לתצוגה; הריפוד מוודא שהוא עוצר
          // מעל רצועת הפעולות הדביקה שבתחתית מסך היצירה ולא נחסם מאחוריה.
          className="flex-1 scroll-mb-32"
        >
          {he.directory.saveProfessional}
        </Button>
        <Button variant="secondary" size="compact" onClick={onCancel}>
          {he.common.cancel}
        </Button>
      </div>
    </div>
  );
}
