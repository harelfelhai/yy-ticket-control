import { db } from "@/lib/db";
import {
  type DraftDisplay,
  type DraftLabelKind,
  type DraftLabels,
  describeDraftFields,
  draftLabelIds,
} from "@/lib/draft/display";
import type { DraftState } from "@/lib/draft/fields";

/**
 * טוען את השמות שמאחורי המזהים של טיוטה ומחזיר את תצוגת מסך 7 / 7א.
 *
 * שאילתה אחת לכל סוג רשומה, ורק לסוגים שיש בהם מזהים — לא שאילתה לכל
 * שדה. אותו דפוס בדיוק חי גם ב-`email-reply.ts` (`loadLabels`) וב-
 * `email-intake.ts` (`idLabelMap`), פרטי לכל קובץ; זה המקום הראשון שמייצא
 * אותו, כדי שהשניים יוכלו לעבור אליו בלי לשכפל אותו בשלישית.
 */
type LabelClient = Pick<typeof db, "site" | "building" | "apartment" | "domain" | "professional" | "user">;

export async function loadDraftLabels(state: DraftState, client: LabelClient = db): Promise<DraftLabels> {
  const ids = draftLabelIds(state);
  const byName = { select: { id: true, name: true } } as const;
  const [site, building, apartment, domain, professional, user] = await Promise.all([
    labelMap(ids.site, (list) => client.site.findMany({ where: { id: { in: list } }, ...byName })),
    labelMap(ids.building, (list) => client.building.findMany({ where: { id: { in: list } }, ...byName })),
    labelMap(ids.apartment, async (list) =>
      (
        await client.apartment.findMany({ where: { id: { in: list } }, select: { id: true, number: true } })
      ).map((row) => ({ id: row.id, name: row.number })),
    ),
    labelMap(ids.domain, (list) => client.domain.findMany({ where: { id: { in: list } }, ...byName })),
    labelMap(ids.professional, (list) =>
      client.professional.findMany({ where: { id: { in: list } }, ...byName }),
    ),
    labelMap(ids.user, (list) => client.user.findMany({ where: { id: { in: list } }, ...byName })),
  ]);
  return { site, building, apartment, domain, professional, user } satisfies Record<
    DraftLabelKind,
    ReadonlyMap<string, string>
  >;
}

export async function describeDraftState(state: DraftState, client: LabelClient = db): Promise<DraftDisplay> {
  return describeDraftFields(state, await loadDraftLabels(state, client));
}

async function labelMap(
  ids: ReadonlySet<string>,
  load: (ids: string[]) => Promise<{ id: string; name: string }[]>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map();
  return new Map((await load([...ids])).map((row) => [row.id, row.name]));
}
