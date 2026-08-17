import { Select } from "yy-ticket-control";

/**
 * החץ מגיע מ-`.control-chevron` ולא מהדפדפן — אותה מחלקה בדיוק יושבת גם על
 * הכפתור של `LearnedSelect`, וזו הדרך היחידה להבטיח ששני הבוררים נראים זהים.
 */
export function Default() {
  return (
    <div className="max-w-sm">
      <Select defaultValue="2">
        <option value="1">אבי כהן — חשמל</option>
        <option value="2">מוסא דיאב — אינסטלציה</option>
        <option value="3">רונן לוי — מיזוג</option>
      </Select>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <Select size="default" defaultValue="1">
        <option value="1">גודל רגיל — 48px, שדה בטופס</option>
      </Select>
      <Select size="compact" defaultValue="1">
        <option value="1">גודל צפוף — 44px, שורת מסננים</option>
      </Select>
    </div>
  );
}

export function States() {
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <Select invalid defaultValue="">
        <option value="">בחר אתר</option>
        <option value="1">רמת השרון, בן גוריון 14</option>
      </Select>
      <Select disabled defaultValue="1">
        <option value="1">רמת השרון, בן גוריון 14</option>
      </Select>
    </div>
  );
}
