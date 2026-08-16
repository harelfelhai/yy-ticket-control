import type { NotificationTarget } from "@/lib/notifier";
import type { NotificationEvent } from "@/lib/notifier/types";

/**
 * סוגי העבודות בתור.
 *
 * הטיפוס בטבלה הוא מחרוזת ולא ספירה של Prisma, בכוונה: הוספת סוג עבודה
 * חדש (תמלול, OCR, גיבוי) לא אמורה לדרוש מיגרציה על טבלה שמכילה שורות
 * ממתינות. הקבועים כאן הם מקור האמת לערכים המותרים.
 */
export const JOB_TYPES = {
  notify: "SEND_NOTIFICATION",
  /** תמלול הקלטה קולית */
  transcribe: "TRANSCRIBE",
  /** חילוץ טקסט מתמונה או מ-PDF */
  extract: "EXTRACT",
  /** סימון פניות ללא תנועה כמוסלמות — רץ יומית ומתזמן את עצמו מחדש */
  escalate: "DAILY_ESCALATION",
  /** גיבוי בסיס הנתונים — רץ יומית ומתזמן את עצמו מחדש */
  backup: "DAILY_BACKUP",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

/**
 * מטען ג'וב השליחה — **מזהים בלבד, לא טקסט מנוסח.**
 *
 * הפיתוי הוא לשמור את ההודעה המוכנה, אבל אז כל תיקון נוסח מפספס את מה
 * שכבר בתור, והטקסט הופך למקור אמת שני לצד `he.ts`. עם מזהים בלבד הג'וב
 * קורא את המצב **בזמן השליחה** — כך קבלן שהוסר בינתיים לא מקבל הודעה,
 * ופנייה שנמחקה לא שולחת דבר.
 */
export interface NotifyJobPayload {
  event: NotificationEvent;
  assignmentId: string;
  /** טקסט השאלה שנשאלה, או ההודעה שנכתבה בשרשור */
  note?: string;
  /**
   * יעד מפורש, ל-`MESSAGE` בלבד — הודעה בשרשור הולכת לצד השני, ומי הצד
   * השני תלוי בכותב ולא באירוע.
   */
  target?: NotificationTarget;
  /**
   * מזהה המשתמש הפנימי שכתב, כשההודעה יוצאת **לנמענים**.
   *
   * מזהה ולא שם, לפי הכלל שלמעלה: השם נקרא בזמן השליחה. בכיוון ההפוך —
   * הודעה מנמען לפותח — אין צורך בשדה כלל, כי הכותב הוא בעל השיוך והשם
   * שלו נשלף ממנו ממילא.
   */
  actorUserId?: string;
}
