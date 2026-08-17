/**
 * החלפה ל-`next/link` בתוך ה-bundle שנשלח ל-claude.ai/design.
 *
 * **הבעיה שזה פותר.** `next/link` האמיתי קורא ל-`process.env.__NEXT_*` בזמן
 * טעינת המודול. מחוץ ל-Next אין `process`, ולכן ה-bundle כולו נופל על
 * `ReferenceError: process is not defined` עוד לפני שרכיב אחד מגיע ל-window —
 * כל 29 הרכיבים נעלמים בבת אחת.
 *
 * **למה shim ולא define של `process`.** הראוטר של Next חסר משמעות בסביבת
 * העיצוב: אין שם ניווט, אין prefetch ואין היסטוריה. `<Link>` נועד להיראות
 * ולהתנהג כמו עוגן, וזה בדיוק מה שהוא כאן. ה-shim גם מוציא את כל ה-runtime
 * של Next מה-bundle — 373KB שרובם קוד ניווט שלא ירוץ אף פעם.
 *
 * מחובר דרך `paths` ב-`.design-sync/tsconfig.ds.json`, ולכן נוגע אך ורק
 * בבנייה של design-sync ולא באפליקציה.
 */

/* eslint-disable @typescript-eslint/no-unused-vars --
   ה-props של Next נשלפים בפירוק **כדי שלא** יגיעו ל-`...rest`; משתנה שאינו
   בשימוש הוא כאן המטרה ולא תקלה. אין דרך לבטל prop בפירוק בלי לתת לו שם. */

import type { AnchorHTMLAttributes, ReactNode } from "react";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string | { pathname?: string };
  children?: ReactNode;
  /* props של Next שאין להם מקבילה ב-DOM — נבלעים כדי שלא ידלפו כאטריביוטים */
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
};

export default function Link({
  href,
  prefetch: _prefetch,
  replace: _replace,
  scroll: _scroll,
  shallow: _shallow,
  passHref: _passHref,
  legacyBehavior: _legacyBehavior,
  locale: _locale,
  ...rest
}: LinkProps) {
  const url = typeof href === "string" ? href : (href?.pathname ?? "#");
  return <a href={url} {...rest} />;
}
