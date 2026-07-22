import type { Channel } from "@/generated/prisma/enums";
import type { BoardSection, DerivedTicketStatus } from "./ticket-status";

/**
 * צורת הנתונים של הלוח וההיגיון הטהור שפועל עליה.
 *
 * מופרד מ-`services/board.ts` (שמדבר עם ה-DB) בכוונה: הקיבוץ למצב סיור
 * הוא חישוב טהור, ובלי ההפרדה בדיקת יחידה עליו הייתה דורשת חיבור לבסיס
 * נתונים — כלומר לא בדיקת יחידה.
 */

/** כרטיס פנייה כפי שהוא מוצג ברשימת הלוח */
export interface BoardCard {
  id: string;
  seq: number;
  buildingName: string | null;
  apartmentNumber: string | null;
  domainName: string | null;
  /** השורה הראשונה בלבד — הכרטיס אינו מקום לקרוא בו תיאור מלא */
  descriptionLine: string;
  channel: Channel;
  recipientNames: string[];
  status: DerivedTicketStatus;
  section: BoardSection;
  reason: string;
  ageDays: number;
  reopened: boolean;
  createdAt: Date;
}

export interface TourGroup {
  key: string;
  label: string;
  cards: BoardCard[];
}

/**
 * "מצב סיור": קיבוץ לפי בניין ודירה, למנהל שנמצא פיזית באתר ורוצה לסגור
 * כמה פניות בסיבוב אחד.
 *
 * טיוטות ופניות בלי מיקום מלא נשארות מוצמדות לראש ואינן נכנסות לקיבוץ:
 * הצגתן תחת "ללא מיקום" הייתה קוברת בדיוק את מה שדורש השלמה.
 */
export function groupForTour(cards: readonly BoardCard[]): {
  drafts: BoardCard[];
  groups: TourGroup[];
} {
  const drafts: BoardCard[] = [];
  const byLocation = new Map<string, TourGroup>();

  for (const card of cards) {
    if (!card.buildingName || !card.apartmentNumber) {
      drafts.push(card);
      continue;
    }

    const key = `${card.buildingName}|${card.apartmentNumber}`;
    const group = byLocation.get(key);
    if (group) {
      group.cards.push(card);
    } else {
      byLocation.set(key, {
        key,
        label: `${card.buildingName} · דירה ${card.apartmentNumber}`,
        cards: [card],
      });
    }
  }

  // מיון לפי שם הבניין ואז לפי מספר הדירה, כדי שהסדר יתאים למסלול הפיזי
  // של מי שמסתובב באתר ולא לסדר שבו הפניות נפתחו. `numeric` נדרש כדי
  // שדירה 10 תבוא אחרי דירה 2 ולא לפניה.
  const groups = [...byLocation.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "he", { numeric: true }),
  );

  return { drafts, groups };
}
