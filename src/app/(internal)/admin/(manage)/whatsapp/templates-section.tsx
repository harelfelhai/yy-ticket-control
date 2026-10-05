import { cardClasses } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listWhatsappTemplates } from "@/lib/services/wa-number";
import { ROW_LIST, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { CreateTemplatesButton } from "./number-actions";

/**
 * "תבניות הודעה" (מסך 17) — נטען מ-Meta בזמן הרינדור, בתוך `Suspense`, כדי
 * שכרטיס המצב (מהבסיס) לא ימתין לו. כשל מחזיר שורה שמסבירה, ולא מפיל את המסך.
 */

/** DESIGN.md § מסך 17: מאושרת — הסתיים; ממתינה, בערעור, מושהית — ממתין; נדחתה, מושבתת — עצור */
const STATUS_TONE: Record<string, ChipTone> = {
  APPROVED: "success",
  PENDING: "warning",
  IN_APPEAL: "warning",
  PAUSED: "warning",
  REJECTED: "danger",
  DISABLED: "danger",
};

export function TemplatesCard({ children }: { children: React.ReactNode }) {
  return (
    <section className={cardClasses("flex flex-col gap-2")}>
      <h2 className={TITLE_DESCRIPTIVE}>{he.whatsappAdmin.templatesTitle}</h2>
      {children}
    </section>
  );
}

export async function TemplatesSection() {
  const view = await listWhatsappTemplates(await requireUser());

  if (!view.ok) {
    return (
      <TemplatesCard>
        <p className="text-sm text-muted">{he.whatsappAdmin.templatesUnavailable}</p>
      </TemplatesCard>
    );
  }

  return (
    <TemplatesCard>
      {view.templates.length === 0 ? (
        <p className="text-sm text-muted">{he.whatsappAdmin.templatesEmpty}</p>
      ) : (
        <ul className={ROW_LIST}>
          {view.templates.map((template) => (
            <li key={`${template.name}:${template.language}`} className="flex flex-wrap items-center gap-2">
              <span className="text-sm" dir="ltr">
                {template.name} · {template.language}
              </span>
              <Chip tone={STATUS_TONE[template.status] ?? "neutral"}>
                {he.whatsappAdmin.templateStatus[template.status] ?? template.status}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      {view.missing.length > 0 ? <CreateTemplatesButton /> : null}
    </TemplatesCard>
  );
}
