/**
 * כותרת `Content-Disposition` לקובץ שמוגש מהאחסון — מקור אחד לשני המסלולים:
 * ה-route שמגיש בתים בעצמו (אחסון מקומי), והכתובת החתומה של R2, שנושאת את
 * הכותרת כפרמטר (`ResponseContentDisposition`).
 *
 * `inline` — הדפדפן פותח (תמונה, PDF). `attachment` — הדפדפן שומר, בשם
 * שנמסר כאן. השם מקודד (RFC 5987) כי הוא מגיע מהמייל הנכנס ועשוי להכיל
 * עברית, רווחים או פסיקים.
 */
export function contentDisposition(kind: "inline" | "attachment", filename: string | null): string {
  return `${kind}; filename*=UTF-8''${encodeURIComponent(filename ?? "file")}`;
}
