"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useHydrated } from "@/lib/use-hydrated";
import { createUserAction, setUserActiveAction } from "../actions";

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

  const inputClass = "min-h-11 rounded-lg border border-border px-3 text-base";

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">{he.admin.newUser}</h2>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {he.admin.userName}
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {he.admin.userPhone}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              inputMode="tel"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {he.admin.userEmail}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              inputMode="email"
              className={inputClass}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {he.admin.userRole}
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-base"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {he.role[r]}
                </option>
              ))}
            </select>
          </label>

          {role === "SITE_MANAGER" ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {he.admin.userSite}
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="min-h-11 rounded-lg border border-border bg-surface px-3 text-base"
              >
                <option value="">{he.common.choose}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {he.admin.userPassword}
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            dir="ltr"
            className={inputClass}
          />
        </label>

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
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {user.name}
                {!user.active ? (
                  <span className="mr-2 rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">
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
