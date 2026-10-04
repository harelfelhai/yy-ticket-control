"use client";

import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { setUserWhatsappIntakeAction } from "../../actions";

/**
 * "רשאי לפתוח פניות בוואטסאפ" בכרטיס המשתמש (אפיון §3.7 שדה 5, עדכון 1.4;
 * DESIGN.md § פתיחה במייל ובוואטסאפ בכרטיס המשתמש).
 *
 * **מתג בלבד, בלי שדה נוסף.** הזהות בוואטסאפ היא הטלפון שבכרטיס, שכבר חובה
 * וייחודי (§7 שורה 104) — אין מקבילה ל"כתובות נוספות" של המייל.
 *
 * נשמר מיד, כמו מתג המייל שלצידו, והערך נגזר מה-props: אחרי הפעולה ה-RSC
 * מרנדר מחדש, ועותק מקומי היה מקפיא את המתג על מה שהיה.
 */
export function WhatsappIntakeField({ userId, enabled }: { userId: string; enabled: boolean }) {
  const toggle = useAction();

  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-7 items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle.run(() => setUserWhatsappIntakeAction(userId, e.target.checked))}
          disabled={toggle.busy}
          className="size-4 shrink-0"
        />
        <span className="text-sm font-medium">{he.admin.whatsappIntakeEnabled}</span>
      </label>
      {toggle.error ? <FormError>{toggle.error}</FormError> : null}
    </div>
  );
}
