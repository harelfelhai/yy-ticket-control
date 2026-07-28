"use client";

import { useState } from "react";
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
    // scroll-mb-32: כשהטופס נפתח בתוך מסך עם רצועת פעולות דביקה בתחתית
    // (מסך היצירה), הריפוד-לגלילה מוודא שכפתור השמירה נגלל מעל הרצועה
    // ולא נחסם מאחוריה.
    <div className="flex scroll-mb-32 flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {he.directory.professionalName}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11 rounded-lg border border-border px-3 text-base font-normal"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {he.directory.phone}
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            inputMode="tel"
            className="min-h-11 rounded-lg border border-border px-3 text-base font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {he.directory.email}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
            inputMode="email"
            className="min-h-11 rounded-lg border border-border px-3 text-base font-normal"
          />
        </label>
      </div>

      {/* הכלל מוצג מראש ולא רק ככשל, כי בלי אחד מהשניים אי אפשר לשגר כלל */}
      <p className="text-xs text-muted">{he.directory.contactRequiredHint}</p>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          // scroll-mb-32: הכפתור הוא זה שנגלל לתצוגה; הריפוד מוודא שהוא עוצר
          // מעל רצועת הפעולות הדביקה שבתחתית מסך היצירה ולא נחסם מאחוריה.
          className="min-h-11 flex-1 scroll-mb-32 rounded-xl bg-brand px-4 font-medium text-brand-fg disabled:opacity-60"
        >
          {he.directory.saveProfessional}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-xl border border-border px-4"
        >
          {he.common.cancel}
        </button>
      </div>
    </div>
  );
}
