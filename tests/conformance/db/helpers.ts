import type { Role } from "@/generated/prisma/enums";

/**
 * גשר דק לפונקציות ההרשאה של המערכת.
 *
 * הבדיקות כאן קוראות ל**מקור האמת** (`src/lib/permissions.ts`) ולא משכפלות
 * את הכללים, כי בדיקה שמממשת מחדש את הכלל מאמתת את עצמה.
 */
export {
  canCloseTicket,
  canCommentOnTicket,
  canDeleteTicket,
  canEditAssignments,
  canReopenTicket,
  canViewTicket,
  canViewTagChat,
  canViewTagTickets,
} from "@/lib/permissions";

export function toViewerFromUser(user: { id: string; role: Role; siteId: string | null }) {
  return { kind: "user" as const, id: user.id, role: user.role, siteId: user.siteId };
}
