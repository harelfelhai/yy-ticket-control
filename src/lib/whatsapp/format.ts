/**
 * הדגשה של וואטסאפ — `*…*` — כמקטעים, כדי ששיחת הוואטסאפ במסך 7 תציג את מה שהשולח
 * ראה בטלפון, ולא כוכביות.
 *
 * **ההפך של `renderParagraph` ב-`render.ts`.** המערכת מדגישה את הכותרות בהודעות
 * האישור ("בטיוטה עכשיו:", "חסר:") בכוכביות צמודות לאות, וזה גם הכלל של וואטסאפ:
 * כוכבית שאחריה רווח, או מקטע שחוצה שורה, אינם הדגשה — הם נשארים כמו שהם. אותו כלל
 * חל על מה שהשולח עצמו הדגיש בהודעה שלו.
 *
 * הדגשה בלבד: זה מה שהמערכת כותבת. נטוי (`_`), קו חוצה (`~`) וטקסט קבוע (```) של
 * שולח נשארים כסימנים — עדיף סימן גלוי על פענוח שגוי של קו תחתון בשם קובץ.
 */
export interface WaTextSegment {
  text: string;
  bold: boolean;
}

const BOLD = /\*([^\s*](?:[^*\n]*[^\s*])?)\*/g;

export function whatsappBold(text: string): WaTextSegment[] {
  const segments: WaTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(BOLD)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), bold: false });
    segments.push({ text: match[1]!, bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false });
  return segments;
}
