import { redirect } from "next/navigation";

/**
 * מסך החיפוש אוחד לתוך הלוח (סבב הצפיפות) — וזה מה שנשאר ממנו.
 *
 * **למה הפניה ולא מחיקה.** הכתובת הזו יצאה החוצה: קישורים שנשלחו בוואטסאפ,
 * סימניות של מנהלים, ובדיקת ההרשאות בקונפורמנס שמוכיחה בידוד בין אתרים
 * דרך `/search?q=<מחרוזת>`. מחיקת המסלול הייתה הופכת את כולם ל-404 — כלומר
 * מייצרת תקלה שנראית כמו שבירה, במקום מעבר.
 *
 * ה-`q` נשמר בהפניה: המשתמש נוחת על הלוח עם אותו חיפוש שכבר רץ.
 */
export default async function SearchRedirect({
  searchParams,
}: PageProps<"/search">) {
  const params = await searchParams;
  const raw = params.q;
  const query = Array.isArray(raw) ? raw[0] : raw;

  redirect(query ? `/board?q=${encodeURIComponent(query)}` : "/board");
}
