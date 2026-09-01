import { LoadingStatus } from "@/components/ui/message";
import { FULL_WIDTH, PAGE_X, TICKET_CARD_GRID } from "@/lib/ui";

/**
 * שלד הלוח — מוצג בכניסת segment (לוגין → לוח, פנייה → לוח) בזמן שהשרת
 * מרכיב את התשובה הראשונה.
 *
 * **סטטי לחלוטין, בלי פעימה** (§ תנועה): מעטפות בגובה קבוע בטוקנים
 * המקודשים, לא אנימציה. ניווטי סינון/מיון **בתוך** הלוח אינם עוברים כאן —
 * הם מעברי same-segment שמקבלים את חיווי ה-pending של הרצועה (ספק #39),
 * והתוכן הקודם נשאר על המסך. הטענה הזו נבדקת ב-`board-load-more.spec.ts`:
 * אם השלד היה מחליף את התוכן בזמן סינון, בדיקת "התוכן נשאר על המסך"
 * הייתה נופלת.
 */
export default function BoardLoading() {
  const shell = "rounded-md border border-border bg-surface";

  return (
    <div className={`flex flex-col gap-3 py-3 pb-24 ${PAGE_X} ${FULL_WIDTH}`}>
      <LoadingStatus />
      {/* מקומות רצועת החיפוש והמסננים */}
      <div className="flex flex-col gap-2" aria-hidden="true">
        <div className={`h-8 w-full max-w-144 ${shell}`} />
        <div className={`h-7 w-full ${shell}`} />
      </div>
      {/* שש מעטפות כרטיס — בגובה כרטיס פנייה טיפוסי */}
      <div className={TICKET_CARD_GRID} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`h-24 ${shell}`} />
        ))}
      </div>
    </div>
  );
}
