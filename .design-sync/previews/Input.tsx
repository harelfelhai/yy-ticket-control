import { Input } from "yy-ticket-control";

/** ‏48px — שדה בטופס. */
export function Default() {
  return (
    <div className="max-w-sm">
      <Input defaultValue="רמת השרון, בן גוריון 14" />
    </div>
  );
}

/**
 * ‏`compact` הוא 44px — פקד בשורה צפופה. גודל הגופן נשאר `text-base` בשני
 * הגדלים: ספארי ב-iOS מגדיל את כל העמוד כשמתמקדים בפקד מתחת ל-16px.
 */
export function Sizes() {
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <Input size="default" defaultValue="גודל רגיל — 48px" />
      <Input size="compact" defaultValue="גודל צפוף — 44px" />
    </div>
  );
}

/** מצבים: ריק עם placeholder, שגוי, ומושבת. */
export function States() {
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <Input placeholder="חיפוש לפי שם או טלפון" />
      <Input invalid defaultValue="050-12" />
      <Input disabled defaultValue="לא ניתן לעריכה" />
    </div>
  );
}
