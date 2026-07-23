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
  /** טקסט השאלה שנשאלה, כשהאירוע הוא שאלה */
  note?: string;
}
