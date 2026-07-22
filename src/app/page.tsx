import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

/**
 * שורש האתר אינו מסך בפני עצמו. מנהל עבודה שפותח את המערכת בבוקר רוצה
 * להגיע ללוח, וכל מסך ביניים הוא לחיצה מיותרת בשטח.
 */
export default async function RootPage() {
  redirect((await getSessionUser()) ? "/board" : "/login");
}
