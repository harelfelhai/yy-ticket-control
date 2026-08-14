import { dayKey, formatDaySeparator } from "./format";
import type { ThreadMessageView } from "./thread-view";

/**
 * הרכבת רשימת הפריטים של השרשור: הודעות, אירועי מערכת, ומפרידי יום ביניהם.
 *
 * **למה פונקציה טהורה ולא לוגיקה בתוך ה-JSX.** ההחלטה "האם להציב מפריד כאן"
 * תלויה בפריט הקודם, באזור הזמן ובשעה הנוכחית — כלומר בדיוק סוג הלוגיקה
 * שנשברת בשקט ואי אפשר לראות אותה בצילום מסך. כאן היא נבדקת ישירות.
 *
 * מפריד היום נגזר מ-`dayKey` בשעון ישראל ולא מ-`getDate()`: הודעה מ-01:30
 * בישראל היא 22:30 של אתמול ב-UTC, ושרת שרץ ב-UTC היה מציב מפריד באמצע הלילה.
 */

export type ThreadItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "event"; key: string; eventType: string | null; meta: unknown }
  | { kind: "message"; key: string; message: ThreadMessageView };

export interface ThreadSourceMessage {
  id: string;
  kind: "TEXT" | "MEDIA" | "EVENT";
  eventType: string | null;
  eventMeta: unknown;
  createdAt: Date;
  view: ThreadMessageView;
}

export interface BuildThreadItemsInput {
  /**
   * ההודעה הפותחת — תיאור הפנייה (אפיון §7 שורה 26). נמסרת בנפרד ולא
   * כחלק מהרשימה, כי היא אינה רשומת `Message` ואין לה מזהה משלה ב-DB.
   */
  opening: ThreadMessageView | null;
  messages: ThreadSourceMessage[];
  now: Date;
  labels: { today: string; yesterday: string };
}

export function buildThreadItems({
  opening,
  messages,
  now,
  labels,
}: BuildThreadItemsInput): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastDay: string | null = null;

  /** מציב מפריד יום אם הפריט הבא נכתב ביום אחר מקודמו */
  function pushDayIfChanged(at: Date): void {
    const key = dayKey(at);
    if (key === lastDay) return;
    lastDay = key;
    items.push({
      kind: "day",
      key: `day-${key}`,
      label: formatDaySeparator(at, now, labels),
    });
  }

  if (opening) {
    pushDayIfChanged(opening.createdAt);
    items.push({ kind: "message", key: opening.id, message: opening });
  }

  for (const message of messages) {
    pushDayIfChanged(message.createdAt);

    if (message.kind === "EVENT") {
      items.push({
        kind: "event",
        key: message.id,
        eventType: message.eventType,
        meta: message.eventMeta,
      });
      continue;
    }

    items.push({ kind: "message", key: message.id, message: message.view });
  }

  return items;
}
