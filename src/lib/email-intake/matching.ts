import type { Room } from "@/generated/prisma/enums";
import { he } from "@/lib/he";
import { normalizeApartmentNumber } from "@/lib/normalize";
import { ROOMS } from "@/lib/rooms";
import { normalizeHebrew } from "./subject";

/**
 * התאמת ערך שנכתב במייל לרשומה קיימת (אפיון §2.6 שלב 3, EM-07, EM-08).
 *
 * המחלץ מחזיר טקסט כפי שנכתב ("לחשמל", "יוסי", "א'") ולעולם לא מזהה, וההתאמה
 * נעשית כאן, בקוד: מודל שפה שמתבקש "לבחור מהרשימה" בוחר גם כשהקלט אינו מתאים
 * לאף פריט. כאן יש שלוש תוצאות בלבד, וכל אחת מדווחת לשולח:
 *
 * - **התאמה יחידה** — הערך נכנס לטיוטה.
 * - **כמה התאמות** — **אף אחת אינה נבחרת** (EM-08). השדה נשאר ריק והמייל החוזר
 *   מפרט את ההתאמות. בחירה באחת הייתה ניחוש שעלול לשלוח את הפנייה לאדם אחר.
 * - **אין התאמה** — השדה נשאר ריק ומדווח "לא נמצא ברשימה". ערך חדש אינו
 *   נוצר (EM-07).
 *
 * **אין כאן התאמה מקורבת (מרחק עריכה, דמיון)**, ובכוונה. "דירה 12 שנקראה 21"
 * הוא בדיוק הכשל שהאפיון חושש ממנו (§2.5): התאמה מקורבת הופכת טעות הקלדה או
 * טעות חילוץ לרשומה אחרת שנראית סבירה, ואז הקבלן נשלח לדירה הלא נכונה בלי
 * שאיש רואה. ערך שלא נמצא מוחזר לשולח, והוא יודע לתקן אותו במילה אחת.
 *
 * הפונקציות רואות רק את המועמדים שהועברו אליהן. מי מועמד — למשל שאיש מקצוע
 * מושבת אינו מועמד (§2.6 שלב 3) — נקבע בשכבת השירות שטוענת את הרשימה.
 */

export interface Candidate<T extends string = string> {
  id: string;
  label: string;
  kind?: T;
}

export type MatchResult<C extends Candidate = Candidate> =
  | { kind: "match"; candidate: C }
  | { kind: "ambiguous"; candidates: C[] }
  | { kind: "none" };

const NONE = { kind: "none" } as const;

// ─────────────────────────────── נרמול ───────────────────────────────

/**
 * כל מה שמקלדות ולקוחות דואר מכניסים במקום גרש וגרשיים.
 *
 * רץ **לפני** NFKC: הוא מפרק את `´` לרווח ולסימן משולב, ואחריו כבר אין תו
 * שאפשר לזהות. "א׳" מהמערכת ו-"א'" מהמקלדת הם אותו בניין, ו-"ממ״ד" שהוקלד
 * כ-`ממ"ד` הוא אותו חדר.
 */
const GERESH_LIKE = /[\u05F3`\u00B4\u2018\u2019\u2032]/g;
const GERSHAYIM_LIKE = /[\u05F4\u201C\u201D\u2033]/g;

/** נרמול בלי פירוק למילים: עברית, גרשיים, אותיות קטנות ובלי תווים בלתי נראים */
function baseNormalize(value: string): string {
  return (
    normalizeHebrew(value.replace(GERESH_LIKE, "'").replace(GERSHAYIM_LIKE, '"'))
      // שני גרשים ברצף הם הדרך הנפוצה להקליד גרשיים במקלדת בלי ״
      .replace(/''/g, '"')
      .toLowerCase()
      // תו ברוחב אפס שהודבק בתוך מילה היה מפצל אותה לשתיים; סימן משולב
      // שנשאר אחרי NFKC אינו חלק מהאות
      .replace(/[\p{Cf}\p{M}]/gu, "")
  );
}

/**
 * מירכאות בקצה מילה הן ציטוט ("כתבתי "מגדלי הים""), לא חלק מהשם. גרש אחרי
 * אות עברית בסוף מילה נשאר, כי הוא חלק ממנה: "א'" (בניין), "מס'", "ג'".
 */
function trimQuotes(token: string): string {
  return token.replace(/^['"]+/, "").replace(/"+$/, "").replace(/(?<![א-ת])'+$/, "");
}

function tokensOf(value: string): string[] {
  return baseNormalize(value)
    .replace(/[^\p{L}\p{N}'"\s]/gu, " ")
    .split(/\s+/)
    .map(trimQuotes)
    .filter(Boolean);
}

/**
 * הצורה שבה שני ערכים מושווים: נרמול עברי (NFKC, בלי כיווניות ובלי ניקוד),
 * גרש וגרשיים אחידים, אותיות קטנות, פיסוק (מלבד גרש וגרשיים) כרווח, ורווח
 * אחד בין מילים.
 */
export function normalizeForMatch(value: string): string {
  return tokensOf(value).join(" ");
}

// ─────────────────────────────── סולם ההתאמה ───────────────────────────────

/** אותיות השימוש שעשויות להיצמד למילה: "לחשמל", "האינסטלציה", "ומיזוג" */
const PREFIX_LETTERS = "והבכלמש";

/**
 * המילה בלי אות שימוש אחת בראשה, או null כשאין מה להסיר.
 *
 * **מילה של שתי אותיות אינה מקוצרת**: "בר", "לב" ו"הר" היו הופכים לאות אחת,
 * ואות אחת מתאימה לבניין "א" או "ב". הסרה של אות אחת בלבד — כך נכתב הכלל;
 * צירופים כמו "מהמטבח" נשארים בלי התאמה ומוחזרים לשולח.
 */
function withoutPrefix(token: string): string | null {
  if (token.length <= 2 || !PREFIX_LETTERS.includes(token.charAt(0))) return null;
  return token.slice(1);
}

/** מה נשאר ממילה אחרי נרמול ייעודי לסוג הרשומה; null — המילה אינה חלק מהשם */
type TokenCanon = (token: string) => string | null;

const asIs: TokenCanon = (token) => token;

function canonTokens(tokens: readonly string[], canon: TokenCanon): string[] {
  return tokens.flatMap((token) => canon(token) ?? []);
}

interface Keyed<C> {
  candidate: C;
  tokens: readonly string[];
  key: string;
}

function keyed<C extends Candidate>(candidates: readonly C[], canon: TokenCanon): Keyed<C>[] {
  return candidates.flatMap((candidate) => {
    const raw = tokensOf(candidate.label);
    const canonical = canonTokens(raw, canon);
    // רשומה ששמה כולו מילים שהנרמול מסיר (בניין שנקרא "בניין") נשארת בשמה המלא
    const tokens = canonical.length > 0 ? canonical : raw;
    return tokens.length > 0 ? [{ candidate, tokens, key: tokens.join(" ") }] : [];
  });
}

/**
 * התאמה אחת, כמה התאמות, או null כדי לעבור לשלב הבא.
 *
 * אותה רשומה שהועברה פעמיים אינה עמימות; איש מקצוע ומשתמש באותו מזהה — כן.
 */
function decide<C extends Candidate>(matches: readonly C[]): MatchResult<C> | null {
  const unique = [...new Map(matches.map((m) => [`${m.kind ?? ""}:${m.id}`, m])).values()];
  if (unique.length === 0) return null;
  if (unique.length === 1) return { kind: "match", candidate: unique[0] };
  return { kind: "ambiguous", candidates: unique };
}

/**
 * סולם ההתאמה, מהמחמיר למקל. **בכל שלב:** מועמד יחיד — התאמה; יותר מאחד —
 * כמה התאמות, והסולם נעצר (EM-08: לא ממשיכים לחפש שלב שבו יישאר אחד); אפס —
 * השלב הבא.
 *
 * 1. שוויון אחרי נרמול.
 * 2. שוויון אחרי הסרת אות שימוש ממילים ("לחשמל" → "חשמל"). S0 מצא שהמחלץ
 *    מחזיר את אות השימוש לסירוגין על אותו קלט ("אינסטלטור"/"האינסטלטור").
 * 3. (כשמותר) הכלה של מילים לאחד מהכיוונים: כל מילות הערך הן מילים של השם
 *    ("יוסי" ⊂ "יוסי כהן"), או כל מילות השם מופיעות בערך
 *    ("יוסי כהן האינסטלטור" ⊃ "יוסי כהן"). ההכלה היא של מילים שלמות — "12"
 *    אינו חלק מ-"112", ו"אינסטל" אינו "אינסטלציה".
 *
 * **הסרת אות השימוש נעשית לכל מילה בנפרד, ורק למילה שאינה בעצמה מילה באחד
 * השמות ברשימה.** בלי התנאי, "שרון" היה מאבד את השי"ן ומתאים גם ל"רון לוי",
 * ו"שרון" נכתב כשרון. עם התנאי, מילה שיש לה פירוש מילולי ברשימה נקראת
 * כמות שהיא; רק מילה שאין לה פירוש כזה נבדקת בלי האות הראשונה. "לשלמה
 * ביטון" מתאים כך ל"שלמה ביטון", אף שה-ב של "ביטון" נראית כאות שימוש.
 *
 * **הסיכון שנשאר, ונרשם:** שם שאינו ברשימה, שהאות הראשונה בו נראית כאות
 * שימוש, עשוי להתאים לשם אחר שכן ברשימה ("לירון" כשיש רק "ירון"). מה שמגן
 * כאן הוא המייל החוזר, שמציג את הנמענים בשמם המלא, ואישור אדם לפני השיגור.
 */
function matchByTokens<C extends Candidate>(
  written: string,
  candidates: readonly C[],
  options: { canon: TokenCanon; containment: boolean },
): MatchResult<C> {
  const writtenTokens = canonTokens(tokensOf(written), options.canon);
  if (writtenTokens.length === 0) return NONE;

  const entries = keyed(candidates, options.canon);
  const writtenKey = writtenTokens.join(" ");

  const exact = decide(entries.filter((e) => e.key === writtenKey).map((e) => e.candidate));
  if (exact) return exact;

  const vocabulary = new Set(entries.flatMap((e) => e.tokens));
  const bare = writtenTokens.flatMap((token) => {
    if (vocabulary.has(token)) return [token];
    const stripped = withoutPrefix(token);
    return stripped === null ? [token] : (options.canon(stripped) ?? []);
  });
  // אחרי ההסרה לא נשארה מילה ("בבניין" בבניין) — ערך ריק אינו מוכל בכל שם
  if (bare.length === 0) return NONE;

  const bareKey = bare.join(" ");
  if (bareKey !== writtenKey) {
    const byPrefix = decide(entries.filter((e) => e.key === bareKey).map((e) => e.candidate));
    if (byPrefix) return byPrefix;
  }

  if (!options.containment) return NONE;

  const writtenSet = new Set(bare);
  const contained = entries.filter((e) => {
    const labelSet = new Set(e.tokens);
    return bare.every((t) => labelSet.has(t)) || e.tokens.every((t) => writtenSet.has(t));
  });
  return decide(contained.map((e) => e.candidate)) ?? NONE;
}

// ─────────────────────────────── לפי סוג רשומה ───────────────────────────────

/** איש מקצוע, משתמש, אתר או תחום */
export function matchName<C extends Candidate>(written: string, candidates: readonly C[]): MatchResult<C> {
  return matchByTokens(written, candidates, { canon: asIs, containment: true });
}

/** המילה "בניין" על צורותיה, כולל עם אות שימוש: "בבניין", "הבניין", "בנ'" */
const BUILDING_WORD = /^[והבכלמש]?(?:בניין|בנין|בנ')$/;
/** אות בודדת עם גרש: "א'" הוא "א" */
const LETTER_WITH_GERESH = /^([א-ת])'$/;

const buildingToken: TokenCanon = (token) =>
  BUILDING_WORD.test(token) ? null : token.replace(LETTER_WITH_GERESH, "$1");

/**
 * בניין: אותם כללים כמו לשם, אחרי שהמילה "בניין" והגרש של אות בודדת מוסרים
 * **משני הצדדים**. בניינים נקראים ברשימה "בניין א" (ההערה על `locationLabel` ב-`he.ts`),
 * ובמייל כותבים "א'", "בנין א" או "בבניין א".
 */
export function matchBuilding<C extends Candidate>(written: string, buildings: readonly C[]): MatchResult<C> {
  return matchByTokens(written, buildings, { canon: buildingToken, containment: true });
}

/** המילים שמקדימות מספר דירה: "דירה", "בדירה", "דירת", "מס'", "מספר" */
const APARTMENT_WORD = /^(?:[והבכלמש]?(?:דירה|דירת)|מס'|מספר)$/;

/**
 * מספר הדירה בלבד, בצורה שבה הוא נשמר (`normalizeApartmentNumber`).
 *
 * בלי פירוק לפיסוק: "12/3" ו-"12-א" הם ערכים, והפיכת הלוכסן לרווח הייתה
 * יוצרת מהם משהו אחר. רק פיסוק בקצוות מילה מוסר ("#12", "12.", "דירה:").
 */
function apartmentKey(value: string): string {
  const tokens = baseNormalize(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}']+$/u, ""))
    .filter((token) => token && !APARTMENT_WORD.test(token));
  return normalizeApartmentNumber(tokens.join(" ").replace(/'+$/, ""));
}

/**
 * דירה: **התאמה מדויקת בלבד**, אחרי הסרת "דירה"/"מס'"/"#" ואפסים מובילים.
 *
 * בלי הכלה ובלי אות שימוש: בדירות ההבדל של תו אחד הוא דירה אחרת — "12"
 * אינו "112" ואינו "12א". "07" ו-"7" הן אותה דירה, כמו בכל המערכת.
 */
export function matchApartment<C extends Candidate>(written: string, apartments: readonly C[]): MatchResult<C> {
  const key = apartmentKey(written);
  if (!key) return NONE;
  return decide(apartments.filter((apartment) => apartmentKey(apartment.label) === key)) ?? NONE;
}

/**
 * שמות נוספים לחדרים, מעבר לתווית שבמערכת (`he.room`).
 *
 * **אינן מחרוזות תצוגה** — אלה מילים שנקראות מהמייל, ולכן הן כאן ולא ב-`he.ts`.
 * הרשימה קצרה בכוונה: רק צורות שאין ספק לאיזה חדר הן מתכוונות. "שירותים"
 * אינו כאן כי הוא התווית של `WC`; "חדר" לבדו אינו חדר.
 */
const ROOM_SYNONYMS: Readonly<Record<Room, readonly string[]>> = {
  SALON: ["חדר מגורים"],
  KITCHEN: [],
  BEDROOM: ["חדר הורים", "חדר ילדים"],
  BATHROOM: ["אמבטיה", "אמבטייה", "חדר אמבטיה", "חדר אמבטייה", "מקלחת", "חדר מקלחת"],
  WC: ["חדר שירותים"],
  BALCONY: [],
  MAMAD: ["ממד", "מרחב מוגן", "מרחב מוגן דירתי"],
  STAIRWELL: ["מדרגות"],
  PARKING: ["חנייה", "חניון", "מקום חניה", "מקום חנייה"],
  LOBBY: [],
  COMMON: ["שטחים משותפים", "רכוש משותף"],
};

interface RoomCandidate extends Candidate {
  room: Room;
}

const ROOM_CANDIDATES: readonly RoomCandidate[] = ROOMS.flatMap((room) =>
  [he.room[room], ...ROOM_SYNONYMS[room]].map((label) => ({ id: room, label, room })),
);

/**
 * חדר: התווית במערכת או מילה נרדפת, אחרי נרמול והסרת אות שימוש ("במטבח").
 *
 * בלי הכלה: "חדר" מוכל בחמישה חדרים ו"שינה" אינו שם של חדר. ערך לא מוכר
 * מחזיר null, והחדר נשאר ריק — הוא אינו שדה חובה (§3.2).
 */
export function matchRoom(written: string): Room | null {
  const result = matchByTokens(written, ROOM_CANDIDATES, { canon: asIs, containment: false });
  return result.kind === "match" ? result.candidate.room : null;
}

// ─────────────────────────────── מופיע בטקסט ───────────────────────────────

/** מילה בצורה שבה היא מושווית בטקסט: בלי אפסים מובילים ובלי גרש של אות בודדת */
function tokenForm(token: string): string {
  return normalizeApartmentNumber(token).replace(LETTER_WITH_GERESH, "$1");
}

function sameToken(a: string, b: string): boolean {
  return a === b || tokenForm(a) === tokenForm(b);
}

/**
 * האם מילה בטקסט היא `word` עם אותיות שימוש לפניה ("בחשמל", "ליוסי", "ב12").
 *
 * לא לפני אות בודדת: אחרת "א" (בניין) היה נמצא בכל "לא" שבמייל.
 */
function isPrefixed(token: string, word: string): boolean {
  if (word.length < 2 && !/^\d+$/.test(word)) return false;
  for (let length = 1; length <= 3 && length < token.length; length++) {
    if (!PREFIX_LETTERS.includes(token.charAt(length - 1))) return false;
    if (sameToken(token.slice(length), word)) return true;
  }
  return false;
}

/** "12 א" כמילה אחת, כדי ש-"12א" יימצא גם כשנכתב ברווח (ולהפך) */
function joinNumberLetter(tokens: readonly string[]): string[] {
  const joined: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1];
    if (/^\d+$/.test(tokens[i]) && next !== undefined && /^[א-ת]'?$/.test(next)) {
      joined.push(tokens[i] + next.replace("'", ""));
      i++;
    } else {
      joined.push(tokens[i]);
    }
  }
  return joined;
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    const found = needle.every((word, offset) => {
      const token = haystack[start + offset];
      // אות שימוש רק לפני המילה הראשונה: "ליוסי כהן", לא "יוסי וכהן"
      return sameToken(token, word) || (offset === 0 && isPrefixed(token, word));
    });
    if (found) return true;
  }
  return false;
}

/**
 * האם ערך שהמחלץ סימן `source: "text"` אכן כתוב בכותרת או בטקסט החדש.
 *
 * **שומר מפני הזיה**, לא מתאים: ערך שהמודל "קרא" ואינו מופיע נזרק לפני
 * ההתאמה, כי המקרה שהאפיון חושש ממנו (§2.5) הוא בדיוק "דירה 12" שנקראה 21 —
 * וערך כזה, אם הוא קיים ברשימה, היה מתאים בלי שום סימן לטעות.
 *
 * ההשוואה היא של מילים שלמות וברצף, אחרי אותו נרמול כמו ההתאמה: "12" אינו
 * ב-"112" וגם לא ב-"12א"; "07" הוא "7"; "12א" נמצא גם כ-"12 א"; מותרות אותיות
 * שימוש לפני המילה הראשונה ("בחשמל"). ערך מקובץ מצורף (`source: "attachment"`)
 * אינו נבדק כאן, כי אין לו טקסט להשוות אליו (S0, ממצא 3).
 */
export function mentionedIn(value: string, haystack: string): boolean {
  const needle = tokensOf(value);
  if (needle.length === 0) return false;
  const hay = tokensOf(haystack);

  const needles = [needle, joinNumberLetter(needle)];
  const hays = [hay, joinNumberLetter(hay)];
  return needles.some((n) => hays.some((h) => containsSequence(h, n)));
}
