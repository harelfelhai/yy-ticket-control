"use client";

import { useState } from "react";
import type { Role } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { createUserAction, setUserActiveAction, updateUserAction } from "../../actions";
import { TITLE_DESCRIPTIVE, CARD_LIST, FORM_PANEL_WIDTH, RECORD_NAME } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { chipClasses } from "@/components/ui/chip";
import { FormError } from "@/components/ui/message";

interface SiteOption {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  siteName: string | null;
  active: boolean;
}

const ROLES: Role[] = ["SITE_MANAGER", "OWNER", "ADMIN"];

/**
 * ניהול משתמשים (מסך 12): הקמה, תפקיד, אתר, והפעלה/השבתה.
 *
 * בורר האתר מוצג רק כשהתפקיד הוא מנהל עבודה — בעלים ומנהל מערכת אינם
 * משויכים לאתר. הסיסמה שנקבעת כאן היא ראשונית; המשתמש מתחבר איתה.
 */
export function UsersManager({ sites, users }: { sites: SiteOption[]; users: UserRow[] }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("SITE_MANAGER");
  const [siteId, setSiteId] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  function add() {
    run(
      () =>
        createUserAction({
          name,
          phone,
          email: email || undefined,
          role,
          siteId: role === "SITE_MANAGER" ? siteId || null : null,
          password,
        }),
      () => {
        setName("");
        setPhone("");
        setEmail("");
        setPassword("");
        setSiteId("");
      },
    );
  }

  return (
    /*
     * **המסך נפתח על הרשימה, לא על הטופס.**
     *
     * קודם היה כאן טור אחד: `<section>` ברוחב העמוד עם שישה ילדים בגובה
     * מלא, כ-438px של טופס לפני שהמשתמש הראשון מופיע. בטלפון פירוש הדבר
     * שמסך "ניהול משתמשים" נפתח על טופס הקמה — כלומר על הפעולה הנדירה —
     * ורשימת המשתמשים, שהיא כל מה שרוב הכניסות באות בשבילה, נדחקה מתחת
     * לקו הקיפול.
     *
     * הפתרון בשני חלקים, ושניהם נחוצים:
     * ‏1. במסך רחב הטופס יורד מרוחב העמוד לפאנל (`FORM_PANEL_WIDTH`) ויושב
     *    **לצד** הרשימה — `lg:flex-row`, והרשימה לוקחת את השארית.
     * ‏2. במסך צר אין לצד מי לשבת, ולכן הוא נערם מעל הרשימה — ושם מה שקונה
     *    את הגובה הוא הפקדים ב-`compact` (32px במקום 36px) והזוגות בשתי
     *    עמודות. הטופס יורד לכ-300px, והרשימה מתחילה בתוך המסך הראשון.
     *
     * ‏`lg:items-start` ולא מתיחה: בלעדיו הפאנל נמתח לגובה רשימה של ארבעים
     * משתמשים — כרטיס ריק בגובה מסך שלם לצד התוכן.
     */
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      <section className={cardClasses(`flex flex-col gap-2 ${FORM_PANEL_WIDTH} lg:shrink-0`)}>
        <h2 className={TITLE_DESCRIPTIVE}>{he.admin.newUser}</h2>

        <Field label={he.admin.userName}>
          <Input value={name} onChange={(e) => setName(e.target.value)} size="compact" />
        </Field>

        {/*
         * טלפון ומייל, ותפקיד ואתר, נשארים בשתי עמודות גם בפאנל של 320px:
         * ‏154px לשדה הוא צר, אבל הערכים עצמם קצרים ונגללים בתוך השדה —
         * ואילו ערימה של שישה שדות מלאים היא בדיוק הגובה שהוסר כאן.
         */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.userPhone}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              inputMode="tel"
              size="compact"
            />
          </Field>
          <Field label={he.admin.userEmail}>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              inputMode="email"
              size="compact"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.userRole}>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              size="compact"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {he.role[r]}
                </option>
              ))}
            </Select>
          </Field>

          {role === "SITE_MANAGER" ? (
            <Field label={he.admin.userSite}>
              <Select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                size="compact"
              >
                <option value="">{he.common.choose}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        <Field label={he.admin.userPassword}>
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            dir="ltr"
            size="compact"
          />
        </Field>

        {/* הכפתור בגובה השדות שמעליו — טופס אחד, מידה אחת. */}
        <Button size="compact" onClick={add} disabled={busy} className="self-start">
          {he.admin.addUser}
        </Button>

        {error ? (
          <FormError>
            {error}
          </FormError>
        ) : null}
      </section>

      <ul className={`${CARD_LIST} min-w-0 flex-1`}>
        {users.map((user) => (
          <UserItem key={user.id} user={user} disabled={busy} />
        ))}
      </ul>
    </div>
  );
}

/**
 * שורת משתמש: פרטים, עריכת פרטי קשר, והפעלה/השבתה.
 *
 * **אין כאן מחיקה, וזו הכרעה ולא השמטה** (אפיון §7 שורה 25): לשלוש ההפניות
 * למשתמש יש `SetNull`, ולכן מחיקה הייתה מוחקת בשקט את "מי מטפל" ואת "מי
 * סגר" מכל פנייה שנגע בה. ההשבתה מנתקת אותו בבקשה הבאה ומשאירה את ההיסטוריה.
 *
 * התפקיד והאתר אינם נערכים כאן — הם כפופים לכללי §5.ג ומזיזים הרשאות על
 * פניות קיימות.
 */
function UserItem({ user, disabled }: { user: UserRow; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [email, setEmail] = useState(user.email ?? "");
  const { busy, error, run } = useAction();

  function save() {
    run(
      () => updateUserAction(user.id, { name, phone, email }),
      () => setEditing(false),
    );
  }

  function cancel() {
    setName(user.name);
    setPhone(user.phone);
    setEmail(user.email ?? "");
    setEditing(false);
  }

  if (editing) {
    return (
      <li className={cardClasses("flex flex-col gap-2")}>
        <Field label={he.admin.userName}>
          <Input value={name} onChange={(e) => setName(e.target.value)} size="compact" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.userPhone}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              inputMode="tel"
              size="compact"
            />
          </Field>
          <Field label={he.admin.userEmail}>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              inputMode="email"
              size="compact"
            />
          </Field>
        </div>
        {error ? <FormError>{error}</FormError> : null}
        {/* שני הכפתורים ב-`compact`, כמו שלושת השדות שמעליהם: זו עריכה
            בתוך שורת רשימה ולא הפעולה הראשית של המסך. קודם "שמור" היה
            ‏36px ו"בטל" 32px — הפרש שנקרא כשגיאה ולא כהיררכיה. */}
        <div className="flex gap-2">
          <Button size="compact" onClick={save} disabled={busy} className="flex-1">
            {he.common.save}
          </Button>
          <Button variant="secondary" size="compact" onClick={cancel} disabled={busy}>
            {he.common.cancel}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={cardClasses("flex flex-col gap-1", { padding: "compact" })}>
      {/*
        שורה אחת ולא שלוש.

        פער 33 קבע שהפעולות נצמדות לשם (§ Layout) ולא לקצה הנגדי, וזה נשמר.
        מה שהשתנה בסבב הרוחב המלא הוא **הכיוון**: הפרטים היו עמודה בת שלוש
        שורות והפעולות עמודה בת שתיים, כלומר כל משתמש תפס 105px — פריסה שהייתה
        סבירה בעמודה של 768px ונעשתה בזבזנית ברגע שהמסך נפתח. עכשיו הכול זורם
        בשורה אחת עם `flex-wrap`, כך שבמסך רחב רואים שמונה משתמשים במקום שלושה,
        ובטלפון השורה נשברת מעצמה בדיוק כפי שנשברה קודם.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`${RECORD_NAME} shrink-0`}>
          {user.name}
          {!user.active ? (
            <span className={chipClasses("danger", "soft", "default", "ms-2")}>
              {he.admin.inactiveBadge}
            </span>
          ) : null}
        </span>
        <span className="truncate text-sm text-muted" dir="ltr">
          {user.email ? `${user.phone} · ${user.email}` : user.phone}
        </span>
        <span className="shrink-0 text-sm text-muted">
          {he.role[user.role]}
          {user.siteName ? ` · ${user.siteName}` : ` · ${he.admin.noSite}`}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="secondary"
            size="compact"
            onClick={() => setEditing(true)}
            disabled={disabled || busy}
          >
            {he.admin.editUser}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            onClick={() => run(() => setUserActiveAction(user.id, !user.active))}
            disabled={disabled || busy}
          >
            {user.active ? he.admin.deactivate : he.admin.activate}
          </Button>
        </div>
      </div>
      {error ? <FormError>{error}</FormError> : null}
    </li>
  );
}
