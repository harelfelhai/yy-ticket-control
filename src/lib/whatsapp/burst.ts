/**
 * קיבוץ הודעות רצופות של שולח אחד לדיווחים (אפיון §2.7 שלב 1, §5.ה5 כלל 6,
 * §7 שורה 93). **פונקציה טהורה**: גם "עכשיו" הוא פרמטר, כך שכל שורה בכלל היא
 * מקרה בבדיקת טבלה.
 *
 * בצ'אט דיווח מגיע בכמה הודעות — תמונה, עוד תמונה, ורק אחריהן "תקלה בדירה
 * 12". לכן ההחלטה אינה על הודעה אלא על **דיווח**, והיא מתקבלת כשהשולח מפסיק
 * לכתוב:
 *
 * - **90 שניות שקט**, כשיש בדיווח את המילה או תגובה (Reply) — זה סימן שהוא
 *   שלם.
 * - **עד 10 דקות מההודעה הראשונה** בלעדיהן — כדי שהמילה תוכל להגיע אחרי
 *   התמונות. אחרי התקרה מכריעים בכל מקרה; הודעה בלי מילה ובלי תגובה פשוט
 *   אינה נקלטת.
 * - **תגובה מתחילה דיווח משלה**, כי היא שייכת לטיוטה אחרת (§5.ה5 כלל 6).
 *   הודעות שמגיעות מיד אחריה בלי ציטוט ("…ועוד תמונה") מצטרפות אליה.
 */

/** שקט שאחריו דיווח שיש בו מילה או תגובה מוכרע */
export const BURST_QUIET_MS = 90_000;

/** התקרה לדיווח, מההודעה הראשונה בו */
export const BURST_CEILING_MS = 10 * 60_000;

export interface BurstMessage {
  id: string;
  /** מתי ההודעה נכתבה בוואטסאפ */
  sentAt: Date;
  /** תגובה (Reply) — ההודעה שצוטטה */
  contextWamid: string | null;
  /** "תקלה"/"תקלות" בטקסט, בכיתוב או בתמלול */
  keyword: boolean;
}

export interface BurstUnit {
  /** ההודעות בדיווח, לפי הסדר */
  messageIds: string[];
  /** הדיווח נפתח בתגובה — מסלול ההשלמה */
  contextWamid: string | null;
  keyword: boolean;
}

export interface BurstPlan {
  /** דיווחים שהגיע זמנם, לפי הסדר */
  ready: BurstUnit[];
  /** מתי לבדוק שוב את הדיווח האחרון, כשהוא עוד פתוח */
  waitUntil: Date | null;
}

interface OpenUnit {
  messages: BurstMessage[];
  first: number;
  last: number;
  contextWamid: string | null;
  keyword: boolean;
}

export function planBurst(messages: readonly BurstMessage[], now: Date): BurstPlan {
  const sorted = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime() || a.id.localeCompare(b.id));
  const units: OpenUnit[] = [];

  for (const message of sorted) {
    const at = message.sentAt.getTime();
    const current = units.at(-1);
    if (!current || startsNewUnit(current, message, at)) {
      units.push({ messages: [message], first: at, last: at, contextWamid: message.contextWamid, keyword: message.keyword });
      continue;
    }
    current.messages.push(message);
    current.last = at;
    current.keyword ||= message.keyword;
  }

  const last = units.at(-1);
  if (!last) return { ready: [], waitUntil: null };

  // כל דיווח מלבד האחרון נסגר בידי ההודעה שאחריו — ראו `startsNewUnit`
  const closed = units.slice(0, -1);
  const lastDue = dueAt(last);
  const ready = now.getTime() >= lastDue ? [...closed, last] : closed;

  return {
    ready: ready.map(toUnit),
    waitUntil: now.getTime() >= lastDue ? null : new Date(lastDue),
  };
}

/**
 * האם ההודעה פותחת דיווח חדש — כלומר הדיווח הנוכחי כבר הוכרע, או היה
 * מוכרע, לפני שהיא הגיעה. כך גם הודעות שנצברו בזמן שהשרת היה למטה מתחלקות
 * בדיוק כמו שהיו מתחלקות בזמן אמת.
 */
function startsNewUnit(current: OpenUnit, message: BurstMessage, at: number): boolean {
  if (message.contextWamid) return true;
  if (at - current.first > BURST_CEILING_MS) return true;
  return closable(current) && at - current.last > BURST_QUIET_MS;
}

/** דיווח שיש בו מילה או תגובה נסגר בשקט; בלעדיהן — רק בתקרה */
function closable(unit: OpenUnit): boolean {
  return unit.keyword || unit.contextWamid !== null;
}

function dueAt(unit: OpenUnit): number {
  const ceiling = unit.first + BURST_CEILING_MS;
  return closable(unit) ? Math.min(unit.last + BURST_QUIET_MS, ceiling) : ceiling;
}

function toUnit(unit: OpenUnit): BurstUnit {
  return {
    messageIds: unit.messages.map((message) => message.id),
    contextWamid: unit.contextWamid,
    keyword: unit.keyword,
  };
}
