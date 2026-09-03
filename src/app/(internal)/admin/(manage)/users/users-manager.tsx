"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import type { Role } from "@/generated/prisma/enums";
import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
import { chipClasses } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError, FormNotice } from "@/components/ui/message";
import { he } from "@/lib/he";
import {
  DIALOG_SCROLL_BODY,
  RECORD_CARD_GRID,
  RECORD_NAME,
  TITLE_DESCRIPTIVE,
} from "@/lib/ui";
import { useAction } from "@/lib/use-action";
import { RecordCard } from "../../record-card";
import {
  createUserAction,
  deleteUserAction,
  resetUserPasswordAction,
  setUserActiveAction,
  updateUserAction,
} from "../../actions";

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
 * **‏0.7 — אותה תבנית של מסך האתרים.** הטופס בן ששת השדות שישב בצד עבר
 * לדיאלוג מאחורי כפתור שצמוד לכותרת, ופרטי הקשר ופעולות העריכה ירדו
 * מהשורה לדיאלוג הפרטים. ‏`FORM_PANEL_WIDTH` ירד מכאן: הוא נולד כדי
 * שהטופס לא ידחק את הרשימה מתחת לקו הקיפול, ודיאלוג פותר את זה מהשורש.
 *
 * בורר האתר מוצג רק כשהתפקיד הוא מנהל עבודה — בעלים ומנהל מערכת אינם
 * משויכים לאתר. הסיסמה שנקבעת כאן היא ראשונית; המשתמש מתחבר איתה.
 */
export function UsersManager({ sites, users }: { sites: SiteOption[]; users: UserRow[] }) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // נגזר ולא נשמר — ראו הנימוק ב-`sites-manager.tsx`: עותק במצב היה
  // מקפיא את הדיאלוג על הערך שלפני השמירה.
  const open = users.find((user) => user.id === openId) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className={TITLE_DESCRIPTIVE}>{he.admin.users}</h1>
        {/* ‏`aria-label` זהה לטקסט הגלוי — ראו הנימוק ב-`sites-manager.tsx`. */}
        <Button
          size="compact"
          onClick={() => setCreating(true)}
          aria-label={he.admin.newUserButton}
        >
          <Plus className="me-1 size-3" aria-hidden="true" />
          {he.admin.newUserButton}
        </Button>
      </div>

      <ul className={RECORD_CARD_GRID}>
        {users.map((user) => (
          <RecordCard key={user.id} label={user.name} onOpen={() => setOpenId(user.id)}>
            <span className={RECORD_NAME}>
              {user.name}
              {!user.active ? (
                <span className={chipClasses("danger", "soft", "default", "ms-2")}>
                  {he.admin.inactiveBadge}
                </span>
              ) : null}
            </span>
            {/*
             * הכרטיס מסכם: תפקיד ואתר הם מה שמבדיל משתמש ממשתמש בסריקה.
             * הטלפון והמייל ירדו לדיאלוג — הם מה שמחפשים **אחרי** שמצאו
             * את השורה, לא מה שמוצאים לפיו.
             */}
            <span className="text-sm text-muted">
              {he.role[user.role]}
              {user.siteName ? ` · ${user.siteName}` : ` · ${he.admin.noSite}`}
            </span>
          </RecordCard>
        ))}
      </ul>

      {creating ? (
        <UserCreateDialog sites={sites} onClose={() => setCreating(false)} />
      ) : null}

      {/*
       * ‏`key` על מזהה הרשומה — הדיאלוג מחזיק מצב טופס פנימי (מה נבחר,
       * מה מוקלד), וללא `key` מעבר מרשומה לרשומה **באותה עמדה** ב-DOM
       * היה משאיר את המצב של הקודמת. היום זה אינו קורה בפועל, מפני
       * שהכיסוי חוסם את הכרטיסים שמאחוריו — כלומר ההגנה היא על הנחה
       * שנכונה במקרה, וזה בדיוק סוג התלות שנשברת בשקט.
       */}
      {open ? (
        <UserDetailsDialog key={open.id} user={open} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

function UserCreateDialog({ sites, onClose }: { sites: SiteOption[]; onClose: () => void }) {
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
      onClose,
    );
  }

  return (
    <Dialog title={he.admin.newUser} onClose={onClose}>
      <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>
        <Field label={he.admin.userName}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="compact"
            disabled={busy}
          />
        </Field>

        {/*
         * הזוגות נשארים בשתי עמודות. בפאנל של 320px זו הייתה החלטת גובה;
         * כאן היא נשארת מפני שהיא נכונה בפני עצמה — טלפון ומייל הם זוג,
         * ותפקיד ואתר הם זוג, וערימה של שישה שדות מלאים מסתירה את הכפתור
         * מתחת לגלילה של הדיאלוג.
         */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.userPhone}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              inputMode="tel"
              size="compact"
              disabled={busy}
            />
          </Field>
          <Field label={he.admin.userEmail}>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              inputMode="email"
              size="compact"
              disabled={busy}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.userRole}>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              size="compact"
              disabled={busy}
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
                disabled={busy}
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
            disabled={busy}
          />
        </Field>

        {error ? <FormError>{error}</FormError> : null}

        <div className="flex gap-2">
          <Button size="compact" onClick={add} disabled={busy}>
            {he.admin.addUser}
          </Button>
          <Button variant="secondary" size="compact" onClick={onClose} disabled={busy}>
            {he.common.cancel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * פרטי משתמש: הצגה, עריכת פרטי קשר, והפעלה/השבתה.
 *
 * **אין כאן מחיקה, וזו הכרעה ולא השמטה** (אפיון §7 שורה 25): לשלוש
 * ההפניות למשתמש יש `SetNull`, ולכן מחיקה הייתה מוחקת בשקט את "מי מטפל"
 * ואת "מי סגר" מכל פנייה שנגע בה. ההשבתה מנתקת אותו בבקשה הבאה ומשאירה
 * את ההיסטוריה.
 *
 * **התפקיד והאתר אינם נערכים כאן** — הם כפופים לכללי §5.ג ומזיזים הרשאות
 * על פניות קיימות. שיוך מנהל עבודה לאתר נעשה ממסך האתרים (0.7), שם
 * ההשלכה — מי מקבל גישה לאיזה אתר — נראית לצד האתר עצמו.
 */
function UserDetailsDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [email, setEmail] = useState(user.email ?? "");
  const { busy, error, run } = useAction();

  function cancel() {
    setName(user.name);
    setPhone(user.phone);
    setEmail(user.email ?? "");
    setEditing(false);
  }

  return (
    <Dialog title={he.admin.userDetails} onClose={onClose}>
      <div className={`flex flex-col gap-3 ${DIALOG_SCROLL_BODY}`}>
        {editing ? (
          <>
            <Field label={he.admin.userName}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                size="compact"
                disabled={busy}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={he.admin.userPhone}>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  dir="ltr"
                  inputMode="tel"
                  size="compact"
                  disabled={busy}
                />
              </Field>
              <Field label={he.admin.userEmail}>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                  inputMode="email"
                  size="compact"
                  disabled={busy}
                />
              </Field>
            </div>
            {error ? <FormError>{error}</FormError> : null}
            <div className="flex gap-2">
              <Button
                size="compact"
                disabled={busy}
                onClick={() =>
                  run(() => updateUserAction(user.id, { name, phone, email }), () =>
                    setEditing(false),
                  )
                }
              >
                {he.common.save}
              </Button>
              <Button variant="secondary" size="compact" onClick={cancel} disabled={busy}>
                {he.common.cancel}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={RECORD_NAME}>{user.name}</span>
              {!user.active ? (
                <span className={chipClasses("danger", "soft")}>{he.admin.inactiveBadge}</span>
              ) : null}
              {/*
               * העיפרון פותח את שלושת השדות הניתנים לעריכה. השם הנגיש
               * הוא `he.admin.editUser` — אותה מחרוזת שהייתה התווית
               * הגלויה, כך שהבוררים ב-e2e אינם משתנים (§ אייקונים).
               */}
              <Button
                variant="quiet"
                size="compact"
                onClick={() => setEditing(true)}
                aria-label={he.admin.editUser}
              >
                <Pencil className="size-3" aria-hidden="true" />
              </Button>
            </div>

            {/*
             * ‏`dir="ltr"` על פרטי הקשר: טלפון ומייל הם מחרוזות לטיניות,
             * וב-RTL סימני הפיסוק שבהם קופצים לקצה השגוי (§ RTL).
             */}
            <dl className="flex flex-col gap-1 text-sm">
              <DetailRow label={he.admin.userPhone} value={user.phone} ltr />
              <DetailRow label={he.admin.userEmail} value={user.email ?? "—"} ltr />
              <DetailRow label={he.admin.userRole} value={he.role[user.role]} />
              <DetailRow label={he.admin.userSite} value={user.siteName ?? he.admin.noSite} />
            </dl>

            {error ? <FormError>{error}</FormError> : null}

            <ResetPasswordRow userId={user.id} userName={user.name} />

            {/*
             * השבתה ומחיקה זו לצד זו, כמו בדיאלוג איש המקצוע — שתי דרכי
             * הוצאה עם גבול ברור ביניהן: השבתה למי שעזב, ומחיקה לרשומה
             * שנוצרה בטעות. המחיקה נחסמת מהשרת ברגע שיש ולו הפניה אחת,
             * וההודעה נוקבת במה חוסם ובכמה.
             */}
            <div className="flex items-start gap-2 border-t border-border pt-3">
              <Button
                variant="secondary"
                size="compact"
                disabled={busy}
                onClick={() => run(() => setUserActiveAction(user.id, !user.active))}
              >
                {user.active ? he.admin.deactivate : he.admin.activate}
              </Button>
              <DeleteButton
                name={user.name}
                action={deleteUserAction.bind(null, user.id)}
                disabled={busy}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * איפוס סיסמה בידי מנהל (1.1).
 *
 * **מקופל מאחורי כפתור ואינו שדה פתוח בדיאלוג.** הדיאלוג הזה נפתח בכל
 * לחיצה על כרטיס משתמש — כלומר בעיקר כדי *לקרוא* פרטים — ושדה סיסמה פתוח
 * בכל פתיחה כזו מזמין הקלדה בהיסח הדעת לתוך הפעולה ההרסנית ביותר במסך.
 * הכפתור הוא הכוונה המפורשת, והשדה נפתח רק אחריו.
 *
 * אין כאן `window.confirm` כמו במחיקה: המשתמש כבר הקליד סיסמה שלמה, וזו
 * כוונה מפורשת דיה. אישור נוסף היה הרגל של לחיצה אוטומטית.
 */
function ResetPasswordRow({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  if (!open) {
    return (
      <div className="border-t border-border pt-3">
        <Button variant="secondary" size="compact" onClick={() => setOpen(true)}>
          {he.admin.resetPassword}
        </Button>
        {done ? <FormNotice className="mt-2">{he.admin.resetPasswordDone}</FormNotice> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <Field label={he.admin.resetPasswordFor(userName)}>
        <Input
          type="password"
          autoComplete="new-password"
          dir="ltr"
          size="compact"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </Field>
      {error ? <FormError>{error}</FormError> : null}
      <div className="flex gap-2">
        <Button
          size="compact"
          disabled={busy || !password}
          onClick={() =>
            run(() => resetUserPasswordAction(userId, password), () => {
              setPassword("");
              setOpen(false);
              setDone(true);
            })
          }
        >
          {he.common.save}
        </Button>
        <Button
          variant="secondary"
          size="compact"
          disabled={busy}
          onClick={() => {
            setPassword("");
            setOpen(false);
          }}
        >
          {he.common.cancel}
        </Button>
      </div>
    </div>
  );
}

/**
 * שורת "תווית: ערך" בפאנל פרטים.
 *
 * **ערך שאינו ניתן לשינוי אינו שדה מושבת** (§ Field): תווית ב-`text-sm
 * font-medium` והערך מתחתיה כטקסט — בלי מסגרת פקד ובלי `opacity-60`,
 * שנקראים בדיוק כמו placeholder של שדה ריק.
 */
function DetailRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="font-medium">{label}</dt>
      <dd className="min-w-0 truncate text-muted" dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}
