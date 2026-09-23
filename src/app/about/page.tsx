import Link from "next/link";
import { he } from "@/lib/he";
import { CONTENT_WIDTH, PAGE_X, TITLE_DESCRIPTIVE, TITLE_IDENTIFYING, LINK } from "@/lib/ui";

export const metadata = { title: `${he.about.title} — ${he.app.name}` };

/**
 * עמוד "אודות" — ציבורי, בלי התחברות.
 *
 * נוצר לצורך O1 (פתיחת פנייה במייל): Google דורשת URL יציב ל"App home
 * page" באימות ההיקף `gmail.readonly`. `/` עצמו תמיד מפנה הלאה (למשתמש
 * מחובר או ל-`/login`) ואינו יכול לשמש ככתובת הזו — ראו `src/app/page.tsx`.
 */
export default function AboutPage() {
  return (
    <main className={`flex-1 py-8 ${PAGE_X}`}>
      <div className={`${CONTENT_WIDTH} flex flex-col gap-6`}>
        <div>
          <h1 className={TITLE_IDENTIFYING}>{he.about.title}</h1>
          <p className="mt-2 text-base leading-relaxed text-muted">{he.about.lead}</p>
        </div>

        {he.about.sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h2 className={TITLE_DESCRIPTIVE}>{section.title}</h2>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index} className="text-base leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <p className="text-base leading-relaxed">
          <Link href="/privacy" className={LINK}>
            {he.about.privacyLinkText}
          </Link>
        </p>

        <div className="border-t border-border pt-4 text-sm text-muted">
          {he.about.contactLabel}:{" "}
          <a href={`mailto:${he.about.contactEmail}`} className={LINK}>
            {he.about.contactEmail}
          </a>
        </div>
      </div>
    </main>
  );
}
