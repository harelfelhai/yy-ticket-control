"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/message";
import { he } from "@/lib/he";
import { ROW_LIST } from "@/lib/ui";
import { useAction } from "@/lib/use-action";
import {
  addUserEmailAliasAction,
  removeUserEmailAliasAction,
  setUserEmailIntakeAction,
} from "../../actions";

export interface EmailAliasRow {
  id: string;
  address: string;
}

/**
 * פתיחת פניות במייל בכרטיס המשתמש (אפיון §3.7, מסך 12; DESIGN.md § פתיחה
 * במייל בכרטיס המשתמש).
 *
 * **כל פעולה נשמרת מיד**, כמו "השבת"/"הפעל" שבאותו דיאלוג. טופס עם "שמור"
 * היה מוסיף מצב שבו כתובת הוקלדה ולא נשמרה בלי שהמנהל שם לב — והשולח מאותה
 * כתובת לא היה מקבל שום סימן (מייל מכתובת לא מוכרת אינו נענה, §2.6 שלב 2).
 *
 * **הערכים נגזרים מה-props ואינם מועתקים למצב** (§ מסכי ניהול): אחרי כל
 * פעולה ה-RSC מרנדר מחדש, ועותק מקומי היה מקפיא את הרשימה על מה שהייתה.
 * המצב היחיד כאן הוא הטקסט שבשדה ההוספה.
 */
export function EmailIntakeFields({
  userId,
  enabled,
  aliases,
}: {
  userId: string;
  enabled: boolean;
  aliases: EmailAliasRow[];
}) {
  const [address, setAddress] = useState("");
  const toggle = useAction();
  const add = useAction();
  const remove = useAction();
  const busy = toggle.busy || add.busy || remove.busy;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-col gap-1">
        <label className="flex min-h-7 items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggle.run(() => setUserEmailIntakeAction(userId, e.target.checked))}
            disabled={busy}
            className="size-4 shrink-0"
          />
          <span className="text-sm font-medium">{he.admin.emailIntakeEnabled}</span>
        </label>
        {toggle.error ? <FormError>{toggle.error}</FormError> : null}
      </div>

      {/*
       * ‏`<fieldset>`/`<legend>` ולא `Field`: תווית אחת לכמה פקדים — הרשימה
       * ושורת ההוספה — וזה בדיוק תפקידם (אותו נימוק כמו ב-`SiteManagersField`).
       */}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{he.admin.emailAliases}</legend>

        {aliases.length === 0 ? (
          <p className="text-sm text-muted">{he.admin.noEmailAliases}</p>
        ) : (
          <ul className={ROW_LIST}>
            {aliases.map((alias) => (
              <li key={alias.id} className="flex min-h-7 items-center gap-2">
                {/*
                 * ‏`dir="ltr"`: כתובת לטינית ב-RTL מפזרת את ה-@ והנקודות לקצה השגוי.
                 * בלי `flex-1`: ה-X נצמד לכתובת שהוא מסיר, ולא לקצה השורה (§ Layout).
                 */}
                <span className="min-w-0 truncate text-sm" dir="ltr">
                  {alias.address}
                </span>
                <Button
                  variant="dangerQuiet"
                  size="compact"
                  onClick={() => remove.run(() => removeUserEmailAliasAction(alias.id))}
                  disabled={busy}
                  aria-label={he.admin.removeAlias(alias.address)}
                  className="shrink-0"
                >
                  {/* ‏`X` ולא `Trash2`: אין כאן היסטוריה שנמחקת (§ אייקונים). */}
                  <X className="size-3" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {remove.error ? <FormError>{remove.error}</FormError> : null}

        <div className="flex items-center gap-2">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            dir="ltr"
            inputMode="email"
            size="compact"
            aria-label={he.admin.aliasAddress}
            disabled={busy}
          />
          <Button
            variant="secondary"
            size="compact"
            className="shrink-0"
            disabled={busy || address.trim() === ""}
            // השדה מתרוקן **רק בהצלחה**: בכישלון ("הכתובת כבר משויכת ל…")
            // המנהל מתקן את מה שהקליד ואינו מקליד מחדש.
            onClick={() => add.run(() => addUserEmailAliasAction(userId, address), () => setAddress(""))}
          >
            {he.admin.addAlias}
          </Button>
        </div>
        {add.error ? <FormError>{add.error}</FormError> : null}
      </fieldset>
    </div>
  );
}
