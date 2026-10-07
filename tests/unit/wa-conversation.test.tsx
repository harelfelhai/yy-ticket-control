import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaConversation } from "@/app/(internal)/tickets/[id]/wa-conversation";
import { he } from "@/lib/he";
import type { WaConversationFile, WaConversationMessage } from "@/lib/services/wa-correspondence";

/**
 * שיחת הוואטסאפ במסך 7 (WA-S7-01, DESIGN.md § שיחת הוואטסאפ): בועות לפי הסדר, הצד לפי
 * הכיוון ושם הכותב בשני הצדדים, מצב מסירה שקט וכשל צבוע, קבצים עם הסיבה, והודעה שלא
 * נקלטה — במילים.
 */

const NOW = new Date("2026-10-07T12:00:00Z");
const TODAY = new Date("2026-10-07T09:30:00Z");
const YESTERDAY = new Date("2026-10-06T09:30:00Z");

function message(overrides: Partial<WaConversationMessage> & { id: string }): WaConversationMessage {
  return {
    direction: "INBOUND",
    authorName: "דנה כהן",
    text: null,
    at: TODAY,
    outcome: "DRAFT_CREATED",
    delivery: null,
    skippedAfterClose: false,
    files: [],
    ...overrides,
  };
}

function file(overrides: Partial<WaConversationFile> & { id: string }): WaConversationFile {
  return {
    mimeType: "image/jpeg",
    filename: null,
    transcript: null,
    skippedReason: null,
    downloadable: true,
    ...overrides,
  };
}

function system(id: string, overrides: Partial<WaConversationMessage> = {}): WaConversationMessage {
  return message({ id, direction: "OUTBOUND", authorName: null, outcome: null, delivery: "sent", text: "אישור", ...overrides });
}

/** הבועה של הודעה — לפי הטקסט שבה */
function bubbleOf(text: string): HTMLElement {
  const bubble = screen.getByText(text).closest("li")?.firstElementChild;
  if (!(bubble instanceof HTMLElement)) throw new Error(`no bubble for ${text}`);
  return bubble;
}

describe("WaConversation", () => {
  it("כותרת, ומשפט כשאין עדיין הודעות", () => {
    render(<WaConversation messages={[]} now={NOW} />);
    expect(screen.getByRole("region", { name: he.waConversation.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: he.waConversation.title })).toBeInTheDocument();
    expect(screen.getByText(he.waConversation.empty)).toBeInTheDocument();
  });

  it("הצד לפי הכיוון, ושם הכותב בשני הצדדים — המערכת אינה הצופה", () => {
    render(
      <WaConversation
        messages={[message({ id: "a", text: "תקלה בחשמל בדירה 4" }), system("b", { text: "ההודעה שלך נשמרה כטיוטה" })]}
        now={NOW}
      />,
    );
    const report = bubbleOf("תקלה בחשמל בדירה 4");
    expect(report.className).toContain("self-start");
    expect(report.className).toContain("border-border");
    expect(within(report).getByText("דנה כהן")).toBeInTheDocument();

    const ack = bubbleOf("ההודעה שלך נשמרה כטיוטה");
    expect(ack.className).toContain("self-end");
    expect(ack.className).toContain("border-brand");
    expect(within(ack).getByText(he.waConversation.systemSender)).toBeInTheDocument();
  });

  it("קישור ארוך נשבר בתוך הבועה — `wrap-anywhere`, כי `break-word` אינו מקטין את רוחב הבועה", () => {
    // נמדד בריצה החיה (W8): ב-390px בועת אישור עם הקישור לטיוטה יצאה מהכרטיס שמאלה
    // ונחתכה. ב-RTL גלישה שמאלה אינה יוצרת גלילה, ולכן אין לה סימן אחר.
    render(<WaConversation messages={[system("s", { text: "קישור: http://localhost:3100/tickets/cmuy8fnk2000p20etu1o6xxtp" })]} now={NOW} />);
    expect(screen.getByText(/^קישור:/).className).toContain("wrap-anywhere");
  });

  it("ההדגשה של וואטסאפ מוצגת כהדגשה, ולא ככוכביות", () => {
    render(<WaConversation messages={[system("s", { text: "*בטיוטה עכשיו:*\nאתר: נווה שאנן" })]} now={NOW} />);
    const strong = screen.getByText("בטיוטה עכשיו:");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument();
    expect(strong.closest("p")).toHaveTextContent("בטיוטה עכשיו:\nאתר: נווה שאנן", { normalizeWhitespace: false });
  });

  it("מצב מסירה תקין — מילה שקטה ליד השעה; 'לא נשלחה' — Chip אדום", () => {
    render(
      <WaConversation
        messages={[
          system("s1", { text: "נשלח", delivery: "sent" }),
          system("s2", { text: "נמסר", delivery: "delivered" }),
          system("s3", { text: "נקרא", delivery: "read" }),
          system("s4", { text: "נכשל", delivery: "failed" }),
        ]}
        now={NOW}
      />,
    );
    expect(within(bubbleOf("נשלח")).getByText(he.waConversation.delivery.sent).className).toContain("text-muted");
    expect(within(bubbleOf("נמסר")).getByText(he.waConversation.delivery.delivered).className).toContain("text-muted");
    expect(within(bubbleOf("נקרא")).getByText(he.waConversation.delivery.read).className).toContain("text-muted");
    const failed = within(bubbleOf("נכשל")).getByText(he.waConversation.delivery.failed);
    expect(failed.className).toContain("text-danger");
    // ליד השעה, באותה שורה
    expect(failed.parentElement?.querySelector("time")).not.toBeNull();
  });

  it("הודעה שדולגה כי הטיוטה שוגרה לפני שיצאה — הסיבה בשקט, לא כשל", () => {
    render(<WaConversation messages={[system("s", { text: null, delivery: "failed", skippedAfterClose: true })]} now={NOW} />);
    expect(screen.getByText(he.waConversation.sendSkipped).className).toContain("text-muted");
    expect(screen.queryByText(he.waConversation.delivery.failed)).not.toBeInTheDocument();
  });

  it("תגובה שלא נקלטה — בועה בלי תוכן, והסיבה במילים ובצבע של עבודה שנעצרה", () => {
    render(
      <WaConversation
        messages={[message({ id: "r", authorName: "רון לוי", text: null, outcome: "REPLY_NOT_PERMITTED" })]}
        now={NOW}
      />,
    );
    const note = screen.getByText(he.waConversation.outcome.REPLY_NOT_PERMITTED);
    expect(note.className).toContain("text-danger");
    expect(within(note.closest("li")!).getByText("רון לוי")).toBeInTheDocument();
  });

  it("הודעה שנקלטה אינה נושאת הערה — הטיוטה היא התוצאה שלה", () => {
    render(<WaConversation messages={[message({ id: "a", text: "תקלה", outcome: "REPLY_APPLIED" })]} now={NOW} />);
    expect(screen.queryByText(/לא נקלטה|נשמרה בלי/)).not.toBeInTheDocument();
  });

  it("קבצים: תמונה, הקלטה עם התמלול מתחתיה, קובץ שלא נשמר ומסמך שנשמר בשיחה בלבד", () => {
    render(
      <WaConversation
        messages={[
          message({
            id: "a",
            text: "תקלה",
            files: [
              file({ id: "img" }),
              file({ id: "rec", mimeType: "audio/ogg", transcript: "הדוד לא מחמם" }),
              file({ id: "big", mimeType: "video/mp4", filename: "סרטון.mp4", downloadable: false, skippedReason: "too-large" }),
              file({
                id: "doc",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                filename: "הצעה.docx",
                skippedReason: "not-media",
              }),
            ],
          }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/wa-media/img");
    expect(screen.getByText(he.media.audioLabel)).toBeInTheDocument();
    expect(screen.getByText("הדוד לא מחמם")).toBeInTheDocument();

    // לא נשמר: שם בלי קישור, והסיבה
    expect(screen.queryByRole("link", { name: "סרטון.mp4" })).not.toBeInTheDocument();
    expect(screen.getByText("סרטון.mp4")).toBeInTheDocument();
    expect(screen.getByText(he.waConversation.fileSkipped["too-large"])).toBeInTheDocument();

    // נשמר בשיחה בלבד: קישור, והסיבה שהוא לא בטיוטה
    expect(screen.getByRole("link", { name: "הצעה.docx" })).toHaveAttribute("href", "/api/wa-media/doc");
    expect(screen.getByText(he.waConversation.fileSkipped["not-media"])).toBeInTheDocument();
  });

  it("ההורדה מוואטסאפ שנכשלה נאמרת בשם הערוץ, לא 'מתיבת המייל'", () => {
    render(
      <WaConversation
        messages={[message({ id: "a", files: [file({ id: "f", downloadable: false, skippedReason: "download-failed" })] })]}
        now={NOW}
      />,
    );
    expect(screen.getByText(he.waConversation.fileSkipped["download-failed"])).toBeInTheDocument();
    expect(screen.queryByText(/המייל/)).not.toBeInTheDocument();
  });

  it("מפריד יום בין הודעות מימים שונים, כמו בשרשור", () => {
    render(
      <WaConversation
        messages={[message({ id: "a", text: "הדיווח", at: YESTERDAY }), system("b", { text: "האישור", at: TODAY })]}
        now={NOW}
      />,
    );
    expect(screen.getByText(he.ticket.yesterday)).toBeInTheDocument();
    expect(screen.getByText(he.ticket.today)).toBeInTheDocument();
  });
});
