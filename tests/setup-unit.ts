// ‏matchers כמו toBeInTheDocument / toHaveTextContent, שמייצרים הודעות כשל
// קריאות במקום השוואת אובייקטי DOM גולמיים.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// ‏Testing Library לא מנקה בין בדיקות כשמשתמשים ב-Vitest ללא globals,
// ובלי זה רכיבים מבדיקות קודמות נשארים ב-DOM ושאילתות מוצאות שתי תוצאות.
afterEach(() => {
  cleanup();
});
