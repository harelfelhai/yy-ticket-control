import { Field, Textarea } from "@/components/ui/field";
import { he } from "@/lib/he";

interface ReplyFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * שדה כתיבת התגובה — משותף לשרשור הפנייה, לצ׳אט התגית ולשני מסכי הפורטל.
 *
 * **הרכיב מכוון להיות מינימלי, ולא לגדול.** אין לו `className`, אין לו
 * `children`, ואין לו props נוספים — כדי שלא יוכל להפוך ל"קומפוזר תגובה"
 * גנרי. ההחלטה **לא** לבנות קומפוזר כזה מתועדת ב-DESIGN.md § "לא כל כפילות
 * היא רכיב": ארבעת המסכים נבדלים במבנה (כרטיס, באנרים, מדיה בשלוש תצורות,
 * ואפס עד שלושה כפתורים נוספים), ורכיב יחיד היה מקודד את זה כתשעה פרופס.
 *
 * מה שכן משותף להם הוא בדיוק ארבע השורות האלה — וחשוב מזה, `rows={3}`:
 * הערך הזה כבר סטה פעם אחת (`rows={2}` בצ׳אט התגית), ושתי תיבות כתיבה
 * בגבהים שונים לאותה פעולה נקראו כשני רכיבים שונים.
 *
 * נאכף ב-`tests/unit/primitives.test.ts` — `he.ticket.reply` מופיע כאן ורק כאן.
 */
export function ReplyField({ value, onChange, disabled }: ReplyFieldProps) {
  return (
    <Field label={he.ticket.reply}>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        disabled={disabled}
      />
    </Field>
  );
}
