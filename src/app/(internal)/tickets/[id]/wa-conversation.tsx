import { ThreadBubble, ThreadDaySeparator } from "@/components/thread-bubble";
import { chipClasses } from "@/components/ui/chip";
import { he } from "@/lib/he";
import type { MediaView } from "@/lib/media-view";
import type { WaConversationFile, WaConversationMessage } from "@/lib/services/wa-correspondence";
import { buildThreadItems } from "@/lib/thread-items";
import type { ThreadMessageView } from "@/lib/thread-view";
import { whatsappBold } from "@/lib/whatsapp/format";
import { CARD_LIST, LINK, ROW_LIST, TITLE_DESCRIPTIVE } from "@/lib/ui";

/**
 * שיחת הוואטסאפ של פנייה — ההודעות שנקלטו לטיוטה והודעות האישור של המערכת, לפי
 * הסדר, כבועות שיחה (מסך 7, WA-S7-01, §3.2 שדה 20).
 *
 * **Server Component, ואותו רכיב בשני מקומות:** בראש מסך 7 של טיוטה מוואטסאפ, ואחרי
 * השיגור בחלון "פרטים" (מסך 2, WA-S2-01) — שם השיחה **אינה חלק מהשרשור**: השרשור
 * הוא השיחה עם הנמענים, והשיחה הזו הייתה עם השולח.
 *
 * **אותה בועה ואותם מפרידי יום של השרשור** (DESIGN.md § שיחת הוואטסאפ): הודעות השולח
 * בצד ההתחלה, הודעות המערכת בצד הסוף — הצד של המספר העסקי — ושם הכותב בשני הצדדים,
 * כי המערכת אינה הצופה. מצב מסירה תקין הוא מילה שקטה ליד השעה, ורק "לא נשלחה" צבוע.
 */
export function WaConversation({ messages, now }: { messages: WaConversationMessage[]; now: Date }) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const items = buildThreadItems({
    opening: null,
    messages: messages.map((message) => ({
      id: message.id,
      kind: "TEXT" as const,
      eventType: null,
      eventMeta: null,
      createdAt: message.at,
      view: toBubbleView(message),
    })),
    now,
    labels: { today: he.ticket.today, yesterday: he.ticket.yesterday },
  });

  return (
    <section aria-label={he.waConversation.title} className="flex flex-col gap-2">
      <h2 className={TITLE_DESCRIPTIVE}>{he.waConversation.title}</h2>
      {messages.length === 0 ? (
        <p className="text-sm text-muted">{he.waConversation.empty}</p>
      ) : (
        <ol className={CARD_LIST}>
          {items.map((item) => {
            if (item.kind === "day") return <ThreadDaySeparator key={item.key} label={item.label} />;
            const message = byId.get(item.key);
            if (item.kind !== "message" || !message) return null;
            return (
              <li key={item.key} className="flex flex-col">
                <ThreadBubble message={item.message} authorAlways status={deliveryOf(message)} formatText={withWhatsappBold}>
                  <FileNotes files={message.files.filter(hasNote)} />
                  <OutcomeNote message={message} />
                </ThreadBubble>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * הטקסט כמו שהשולח ראה אותו בטלפון: `*…*` הוא הדגשה, ולא כוכביות (`whatsapp/format.ts`).
 * משקל 600, כמו כל הדגשה בתוך טקסט במערכת.
 */
function withWhatsappBold(text: string) {
  return whatsappBold(text).map((segment, index) =>
    segment.bold ? (
      <strong key={index} className="font-semibold">
        {segment.text}
      </strong>
    ) : (
      segment.text
    ),
  );
}

/**
 * ההודעה בצורה שהבועה מכירה. הצד ("own") הוא הכיוון: הודעת מערכת בצד של העסק.
 * המדיה כאן היא רק מה שנשמר ונכנס כמו שהוא — תמונה, וידאו, הקלטה עם התמלול, PDF;
 * קובץ עם הערה (לא נשמר, לא נכנס לטיוטה) מוצג בשורה משלו, עם הסיבה (`FileNotes`).
 */
function toBubbleView(message: WaConversationMessage): ThreadMessageView {
  const fromSystem = message.direction === "OUTBOUND";
  return {
    id: message.id,
    authorName: fromSystem ? he.waConversation.systemSender : (message.authorName ?? he.waConversation.sender),
    own: fromSystem,
    text: message.text,
    media: message.files.filter((file) => !hasNote(file)).map(toMediaView),
    createdAt: message.at,
  };
}

function toMediaView(file: WaConversationFile): MediaView {
  return {
    id: file.id,
    url: fileUrl(file),
    mimeType: file.mimeType,
    name: file.filename ?? "",
    aiText: file.transcript,
    aiNote: null,
  };
}

function fileUrl(file: WaConversationFile): string {
  return `/api/wa-media/${file.id}`;
}

/** קובץ שיש מה לומר עליו: לא נשמר, או נשמר ולא נכנס לטיוטה */
function hasNote(file: WaConversationFile): boolean {
  return file.skippedReason !== null || !file.downloadable;
}

/**
 * קבצים עם הערה — השם (קישור, כשיש בתים) ו-Chip עם הסיבה, כמו בהתכתבות המייל. בלי
 * קישור לקובץ שאין לו בתים: הנתיב היה מחזיר 404.
 */
function FileNotes({ files }: { files: WaConversationFile[] }) {
  if (files.length === 0) return null;
  return (
    <ul className={ROW_LIST}>
      {files.map((file) => {
        const name = file.filename ?? he.waConversation.unnamedFile;
        const reason = file.skippedReason
          ? (he.waConversation.fileSkipped[file.skippedReason] ?? he.waConversation.fileUnavailable)
          : he.waConversation.fileUnavailable;
        return (
          <li key={file.id} className="flex flex-wrap items-center gap-2 text-sm">
            {file.downloadable ? (
              // `<a>` ולא `next/link`: הנתיב מגיש קובץ, לא מסך
              <a href={fileUrl(file)} className={`inline-flex min-h-7 items-center ${LINK}`}>
                {name}
              </a>
            ) : (
              <span>{name}</span>
            )}
            <span className={chipClasses("neutral")}>{reason}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** הודעה מהשולח שתוכנה לא זז לטיוטה, או שנשמרה בלי עיבוד — במילים, ובצבע של עבודה שנעצרה */
function OutcomeNote({ message }: { message: WaConversationMessage }) {
  if (message.direction !== "INBOUND" || !message.outcome) return null;
  const text = (he.waConversation.outcome as Partial<Record<string, string>>)[message.outcome];
  return text ? <p className="text-sm text-danger">{text}</p> : null;
}

/**
 * מצב המסירה של הודעת מערכת, לפני השעה. תקין — מילה שקטה; "לא נשלחה" — Chip
 * danger, כי השולח לא קיבל את האישור. דילוג צפוי (הטיוטה שוגרה או נמחקה לפני
 * שיצא, §7 שורה 77) אינו כשל, והוא נאמר בשקט עם הסיבה.
 */
function deliveryOf(message: WaConversationMessage) {
  if (message.direction !== "OUTBOUND" || !message.delivery) return undefined;
  if (message.skippedAfterClose) return <span className="text-xs text-muted">{he.waConversation.sendSkipped}</span>;
  if (message.delivery === "failed") {
    return <span className={chipClasses("danger")}>{he.waConversation.delivery.failed}</span>;
  }
  return <span className="text-xs text-muted">{he.waConversation.delivery[message.delivery]}</span>;
}
