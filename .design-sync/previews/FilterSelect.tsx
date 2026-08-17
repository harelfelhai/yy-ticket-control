import { FilterSelect } from "yy-ticket-control";

/**
 * בורר בתוך רצועת מסננים. קיים כדי לבטל את `w-full` של `Select`: ברצועה
 * `w-full` הופך כל בורר לשורה שלמה. הרוחב נגזר מהאפשרות הארוכה ביותר
 * וחסום ב-176px, כדי ששם ספק ארוך לא ימתח בורר יחיד על פני כל הרצועה.
 */
export function InRow() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect defaultValue="" aria-label="אתר">
        <option value="">כל האתרים</option>
        <option value="1">רמת השרון, בן גוריון 14</option>
      </FilterSelect>
      <FilterSelect defaultValue="" aria-label="סטטוס">
        <option value="">כל הסטטוסים</option>
        <option value="open">פתוחות</option>
      </FilterSelect>
      <FilterSelect defaultValue="" aria-label="איש מקצוע">
        <option value="">כל אנשי המקצוע</option>
        <option value="2">מוסא דיאב — אינסטלציה</option>
      </FilterSelect>
    </div>
  );
}

/** אפשרות ארוכה — הרוחב נחסם ולא נמתח על פני הרצועה. */
export function LongOption() {
  return (
    <FilterSelect defaultValue="1" aria-label="אתר">
      <option value="1">רמת השרון, שדרות בן גוריון 14, בניין ב׳, קומה 3</option>
    </FilterSelect>
  );
}
