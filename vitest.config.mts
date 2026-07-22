import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * שני סוגי בדיקות, בשתי סביבות נפרדות:
 *
 * - `unit` רץ ב-jsdom ומכסה לוגיקה טהורה ורכיבי React. מהיר, ללא רשת וללא DB.
 * - `integration` רץ ב-node מול בסיס נתונים אמיתי (TEST_DATABASE_URL), כי
 *   חוקים כמו Restrict ואילוצי ייחודיות נאכפים ב-DB — בדיקה מול mock הייתה
 *   מאמתת את ה-mock ולא את המערכת.
 *
 * הרצה: `npm test` (הכול) · `npm run test:unit` · `npm run test:integration`
 */
export default defineConfig({
  // פותר את הכינוי `@/*` מ-tsconfig. Vite תומך בזה במקור מאז גרסה 8,
  // ולכן אין צורך בתוסף vite-tsconfig-paths.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { tsconfigPaths: true },
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup-unit.ts"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/setup-integration.ts"],
          globalSetup: ["tests/global-setup-integration.ts"],
          // כל קובצי האינטגרציה חולקים בסיס נתונים אחד. הרצה במקביל הייתה
          // גורמת לבדיקה אחת לנקות נתונים של בדיקה אחרת באמצע.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
