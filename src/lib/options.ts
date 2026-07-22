/**
 * צורת פריט בבורר רשימה.
 *
 * יושבת במודול נייטרלי ולא בקומפוננטה ולא בקובץ `"use server"`: קובץ עם
 * הכרזת `"use server"` חייב לייצא **רק פונקציות async**, וייצוא של טיפוס
 * ממנו מייצר הפניה בזמן ריצה שמפילה את המסך עם
 * `ReferenceError: ... is not defined`.
 */
export interface SelectOption {
  id: string;
  label: string;
  /** שורת משנה, למשל טלפון של איש מקצוע — עוזרת להבחין בין שני "יוסי" */
  hint?: string;
}
