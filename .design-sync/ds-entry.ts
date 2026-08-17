/**
 * נקודת הכניסה של מערכת העיצוב עבור claude.ai/design.
 *
 * **למה קובץ ייעודי ולא סריקה אוטומטית של `src/components`.** הריפו הזה הוא
 * אפליקציית Next.js ולא ספריית רכיבים: אין `dist/` ואין entry שנשלח. הממיר
 * של design-sync יודע לסנתז entry מכל קובץ `.tsx` תחת שורש המקור — אבל
 * `src/components` מכיל גם רכיבים שקשורים לצד השרת (`media-picker` מייבא
 * server actions, `delete-button` ו-`inline-rename` מייבאים `useAction`),
 * ו-`export *` מהם היה גורר את Prisma ואת כל השרת לתוך bundle דפדפן.
 *
 * לכן ההיקף נבחר כאן במפורש. הקובץ הזה הוא מקור האמת היחיד לשאלה "מה נשלח
 * ל-Claude Design", ומסונכרן עם `componentSrcMap` ב-`.design-sync/config.json`.
 */

// ── פרימיטיבים ────────────────────────────────────────────────────────────
export { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
export type { ButtonVariant } from "@/components/ui/button";
export { Chip, chipClasses } from "@/components/ui/chip";
export type { ChipTone } from "@/components/ui/chip";
export { cardClasses } from "@/components/ui/card";
export { Dialog } from "@/components/ui/dialog";
export { EmptyState } from "@/components/ui/empty-state";
export { Field, Input, Select, Textarea, controlClasses } from "@/components/ui/field";
export { FilterBar, FilterDate, FilterSelect } from "@/components/ui/filter-bar";
export { Banner, FormError, FormNotice } from "@/components/ui/message";

// ── רכיבי מוצר שאינם תלויים בצד השרת ─────────────────────────────────────
export { AudioRecorder } from "@/components/audio-recorder";
export { CameraCapture } from "@/components/camera-capture";
export { LearnedSelect } from "@/components/learned-select";
export { MediaAttachments } from "@/components/media-attachments";
export { ProfessionalCreateForm } from "@/components/professional-create-form";
export { RecipientPicker } from "@/components/recipient-picker";
export { ReplyField } from "@/components/reply-field";
export { AssignmentStatusChip, TicketStatusChip } from "@/components/status-chip";
export { TagChatMessages } from "@/components/tag-chat-messages";
export { ThreadBubble, ThreadDaySeparator } from "@/components/thread-bubble";
export { TicketCard } from "@/components/ticket-card";
export { TicketTable } from "@/components/ticket-table";
