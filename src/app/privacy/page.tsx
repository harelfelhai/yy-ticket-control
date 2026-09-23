import { he } from "@/lib/he";
import { CONTENT_WIDTH, PAGE_X, TITLE_DESCRIPTIVE, TITLE_IDENTIFYING, LINK } from "@/lib/ui";

export const metadata = { title: `${he.privacy.title} — ${he.app.name}` };

/**
 * מדיניות הפרטיות — ציבורית, בלי התחברות.
 *
 * נוצרה לצורך O1 (פתיחת פנייה במייל): Google דורשת URL יציב למדיניות
 * פרטיות בתהליך האימות של ההיקף `gmail.readonly`. התוכן ב-`he.privacy`
 * מתאר את מה שהמערכת עושה בפועל בתיבת המייל — לא נוסח גנרי.
 */
export default function PrivacyPage() {
  return (
    <main className={`flex-1 py-8 ${PAGE_X}`}>
      <div className={`${CONTENT_WIDTH} flex flex-col gap-6`}>
        <div>
          <h1 className={TITLE_IDENTIFYING}>{he.privacy.title}</h1>
          <p className="mt-1 text-sm text-muted">{he.privacy.updated}</p>
          <p className="mt-2 text-base leading-relaxed text-muted">{he.privacy.lead}</p>
        </div>

        {he.privacy.sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h2 className={TITLE_DESCRIPTIVE}>{section.title}</h2>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index} className="text-base leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <div className="border-t border-border pt-4 text-sm text-muted">
          <a href="/about" className={LINK}>
            {he.about.title}
          </a>
        </div>
      </div>
    </main>
  );
}
