import { Chip } from "yy-ticket-control";

/** הצבע נגזר ממשמעות ולא מאסתטיקה — זו רשימת המשמעויות. */
export function Tones() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip tone="neutral">נשלח</Chip>
      <Chip tone="neutralStrong">נצפה</Chip>
      <Chip tone="brand">חשמל</Chip>
      <Chip tone="success">הסתיים</Chip>
      <Chip tone="warning">ממתין להכרעה</Chip>
      <Chip tone="danger">עבודה עצורה</Chip>
    </div>
  );
}

/**
 * ‏`soft` מוסר מידע; `solid` שמור לתגית שהמשתמש עצמו בחר.
 * ההבדל בין השורות הוא בדיוק ההבדל בין "שים לב" ל"זה שלך".
 */
export function Variants() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip variant="soft" tone="brand">
          חשמל
        </Chip>
        <Chip variant="soft" tone="success">
          הסתיים
        </Chip>
        <Chip variant="soft" tone="danger">
          עבודה עצורה
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip variant="solid" tone="brand">
          חשמל
        </Chip>
        <Chip variant="solid" tone="success">
          הסתיים
        </Chip>
        <Chip variant="solid" tone="danger">
          עבודה עצורה
        </Chip>
      </div>
    </div>
  );
}

/** ‏12px למטא-דאטה בכרטיס, 14px לתגית שהיא תוכן בפני עצמו. */
export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip size="default" tone="brand">
        חשמל
      </Chip>
      <Chip size="large" variant="solid" tone="brand">
        אינסטלציה
      </Chip>
    </div>
  );
}
