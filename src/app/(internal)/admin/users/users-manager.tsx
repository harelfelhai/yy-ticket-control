"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { createUserAction, setUserActiveAction } from "../actions";
import { TITLE_DESCRIPTIVE } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { chipClasses } from "@/components/ui/chip";

interface SiteOption {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  name: string;
  phone: string;
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await createUserAction({
        name,
        phone,
        email: email || undefined,
        role,
        siteId: role === "SITE_MANAGER" ? siteId || null : null,
        password,
      });
      if (result.ok) {
        setName("");
        setPhone("");
        setEmail("");
        setPassword("");
        setSiteId("");
      } else {
        setError(result.error);
      }
    });
  }

  function toggleActive(id: string, active: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setUserActiveAction(id, active);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={cardClasses("flex flex-col gap-2")}>
        <h2 className={TITLE_DESCRIPTIVE}>{he.admin.newUser}</h2>

        <Field label={he.admin.userName}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.userPhone}>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              inputMode="tel"
            />
          </Field>
          <Field label={he.admin.userEmail}>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              inputMode="email"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={he.admin.userRole}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {he.role[r]}
                </option>
              ))}
            </Select>
          </Field>

          {role === "SITE_MANAGER" ? (
            <Field label={he.admin.userSite}>
              <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
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
          />
        </Field>

        <Button onClick={add} disabled={busy} className="self-start">
          {he.admin.addUser}
        </Button>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </section>

      <ul className="flex flex-col gap-2">
        {users.map((user) => (
          <li
            key={user.id}
            className={cardClasses("flex items-center justify-between gap-3")}
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {user.name}
                {!user.active ? (
                  <span className={chipClasses("danger", "soft", "default", "ms-2")}>
                    {he.admin.inactiveBadge}
                  </span>
                ) : null}
              </span>
              <span className="text-sm text-muted">
                {he.role[user.role]}
                {user.siteName ? ` · ${user.siteName}` : ` · ${he.admin.noSite}`}
              </span>
            </div>
            <Button
              variant="secondary"
              size="compact"
              onClick={() => toggleActive(user.id, !user.active)}
              disabled={busy}
              className="shrink-0"
            >
              {user.active ? he.admin.deactivate : he.admin.activate}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
