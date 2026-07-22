import { requireUser } from "@/lib/auth";
import { he } from "@/lib/he";

/**
 * שלד הלוח הראשי (מסך 1 באפיון). התוכן — סקשנים לפי אצל מי הכדור, מסננים
 * ומצב סיור — נבנה ב-M1. כאן הוא קיים כדי שמסלול ההתחברות יהיה שלם וניתן
 * לבדיקה מקצה לקצה.
 */
export default async function BoardPage() {
  const user = await requireUser();

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">{he.boardSection.ACTION_REQUIRED}</h1>
      <p className="mt-2 text-muted">
        שלום {user.name}. הלוח ייבנה בשלב הבא.
      </p>
    </div>
  );
}
