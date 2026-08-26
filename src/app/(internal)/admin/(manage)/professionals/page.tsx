import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";
import { listProfessionalsForAdmin } from "@/lib/services/admin";
import { ProfessionalsManager } from "./professionals-manager";
import { FULL_WIDTH, LINK, PAGE_X } from "@/lib/ui";

export const metadata = { title: `${he.admin.professionals} — ${he.app.name}` };

/** ניהול אנשי מקצוע (מסך 13): עריכת פרטים ואיחוד כפילויות. */
export default async function AdminProfessionalsPage() {
  const actor = await requireUser();
  const professionals = await listProfessionalsForAdmin(actor);

  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${FULL_WIDTH}`}>
      {/* קו תחתון ולא `text-brand` — ראו `LINK` ב-`src/lib/ui.ts`. */}
      <Link href="/admin" className={`text-sm ${LINK}`}>
        ← {he.admin.title}
      </Link>

      {/*
       * **הכותרת והמצב הריק ירדו שניהם ל-`ProfessionalsManager` (0.7).**
       *
       * המצב הריק היה כאן ענף אח לרכיב כולו, וזה נשבר ברגע שנוספה הוספה
       * מהמסך הזה: כשאין אף איש מקצוע, הענף הזה החליף את הרכיב — כלומר
       * **הסתיר את הכפתור שנועד למלא אותו**. מצב ריק שמסתיר את הפעולה
       * שממלאת אותו הוא מסך מת (§ EmptyState: "מזמין לפעולה").
       */}
      <ProfessionalsManager professionals={professionals} />
    </div>
  );
}
