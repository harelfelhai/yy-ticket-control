import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // פלט וכלים של design-sync (ראו .design-sync/NOTES.md). `ds-bundle/`
    // מכיל את React מקומפל כ-`_vendor/react.js`, שמפר את חוקי ה-hooks —
    // צפוי בקוד מקומפל, ואינו קוד של הפרויקט. ‏`.ds-sync/` הוא סקריפטים
    // מועתקים של הסקיל. שניהם ב-gitignore, אבל ESLint אינו קורא אותו.
    "ds-bundle/**",
    ".ds-sync/**",
  ]),
]);

export default eslintConfig;
