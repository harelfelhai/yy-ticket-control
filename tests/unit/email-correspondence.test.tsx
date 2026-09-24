import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmailCorrespondence } from "@/app/(internal)/tickets/[id]/email-correspondence";
import { formatDateTime } from "@/lib/format";
import { he } from "@/lib/he";
import type { CorrespondenceMessage } from "@/lib/services/email-correspondence";

/**
 * התכתבות המייל במסך 7 ובחלון "פרטים" (EM-S7-02, EM-S2-01, EM-M01).
 *
 * הרכיב הוא Server Component סינכרוני, ולכן מרונדר כאן ישירות. מה שנבדק:
 * הסדר, "האחרון פתוח והקודמים מקופלים", שולח ומועד לכל מייל, מייל יוצא
 * מזוהה במילים, מייל שלא נקלט נושא את הסיבה, וקובץ מצורף הוא קישור רק
 * כשיש לו בתים שמורים.
 */

function message(overrides: Partial<CorrespondenceMessage> & { id: string }): CorrespondenceMessage {
  return {
    direction: "INBOUND",
    state: "DONE",
    outcome: "DRAFT_CREATED",
    fromAddress: "dana@example.com",
    fromName: "דנה",
    toAddress: null,
    subject: "תקלה בדירה 12",
    bodyText: "יש נזילה מהתקרה",
    receivedAt: new Date("2026-09-20T08:00:00Z"),
    sentAt: null,
    // שונה מ-receivedAt בכוונה (בדקות — התצוגה אינה מציגה שניות): המועד של מייל נכנס הוא מועד הקבלה
    createdAt: new Date("2026-09-20T08:07:00Z"),
    skippedAfterClose: false,
    attachments: [],
    ...overrides,
  };
}

const THREAD: CorrespondenceMessage[] = [
  message({
    id: "m1",
    attachments: [
      {
        id: "att-1",
        filename: "kitchen.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 204800,
        isMedia: true,
        mediaFileId: "media-1",
        skippedReason: null,
        downloadable: true,
      },
      {
        id: "att-2",
        filename: "quote.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 300,
        isMedia: false,
        mediaFileId: null,
        skippedReason: "not-media",
        downloadable: false,
      },
    ],
  }),
  message({
    id: "m2",
    direction: "OUTBOUND",
    state: "SENT",
    outcome: null,
    fromAddress: null,
    fromName: null,
    toAddress: "dana@example.com",
    subject: "Re: תקלה בדירה 12",
    bodyText: "המייל שלך התקבל ונשמר כטיוטה",
    receivedAt: null,
    sentAt: new Date("2026-09-20T08:03:00Z"),
    createdAt: new Date("2026-09-20T08:01:00Z"),
  }),
  message({
    id: "m3",
    outcome: "REPLY_NOT_PERMITTED",
    fromAddress: "boss@example.com",
    fromName: "הבעלים",
    bodyText: "תשנו את הדירה ל-14",
    receivedAt: new Date("2026-09-20T09:00:00Z"),
    createdAt: new Date("2026-09-20T09:00:00Z"),
  }),
];

describe("EmailCorrespondence", () => {
  it("מציג את ההתכתבות לפי הסדר, והמייל האחרון בלבד פתוח", () => {
    const { container } = render(<EmailCorrespondence messages={THREAD} />);

    const section = screen.getByRole("region", { name: he.emailDraft.correspondence });
    expect(within(section).getByRole("heading", { name: he.emailDraft.correspondence })).toBeInTheDocument();

    const panels = container.querySelectorAll("details");
    expect(panels).toHaveLength(3);
    expect(panels[0]).not.toHaveAttribute("open");
    expect(panels[1]).not.toHaveAttribute("open");
    expect(panels[2]).toHaveAttribute("open");
    expect(panels[0]).toHaveTextContent("דנה");
    expect(panels[2]).toHaveTextContent("הבעלים");
  });

  it("לכל מייל המועד שלו — קבלה למייל נכנס, שליחה למייל יוצא — ולא מועד יצירת השורה", () => {
    const { container } = render(<EmailCorrespondence messages={THREAD} />);
    const panels = container.querySelectorAll("details");
    expect(panels[0]).toHaveTextContent(formatDateTime(new Date("2026-09-20T08:00:00Z")));
    expect(panels[0]).not.toHaveTextContent(formatDateTime(new Date("2026-09-20T08:07:00Z")));
    expect(panels[1]).toHaveTextContent(formatDateTime(new Date("2026-09-20T08:03:00Z")));
    expect(panels[1]).not.toHaveTextContent(formatDateTime(new Date("2026-09-20T08:01:00Z")));
  });

  it("ה-summary אינו flex — אחרת משולש הפתיחה נעלם (DESIGN.md § פאנל מתקפל)", () => {
    const { container } = render(<EmailCorrespondence messages={THREAD} />);
    for (const summary of container.querySelectorAll("summary")) {
      expect(summary.className.split(/\s+/)).not.toContain("flex");
    }
  });

  it("גם השורה שבתוך ה-summary אינה inline-flex — קופסה שיורדת כולה מתחת למשולש מעלימה אותו", () => {
    const { container } = render(<EmailCorrespondence messages={THREAD} />);
    for (const summary of container.querySelectorAll("summary")) {
      for (const element of summary.querySelectorAll("*")) {
        expect(element.className.split(/\s+/)).not.toContain("inline-flex");
      }
    }
  });

  it("המועד מבודד ב-<bdi dir='ltr'> בתוך עוטף — הרווח שאחריו בצד של השורה העברית", () => {
    const { container } = render(<EmailCorrespondence messages={THREAD} />);
    const when = formatDateTime(new Date("2026-09-20T08:00:00Z"));
    const date = [...container.querySelectorAll("summary bdi")].find((bdi) => bdi.textContent === when);
    expect(date).toHaveAttribute("dir", "ltr");
    // הרווח על העוטף, שכיוונו כיוון השורה — לא על ה-bdi, שבו "סוף" הוא צד ימין
    expect(date?.className ?? "").not.toContain("me-2");
    expect(date?.parentElement?.className).toContain("me-2");
  });

  it("מייל יוצא מזוהה במילים — 'המערכת' והנמען — ולא בצבע", () => {
    const { container } = render(<EmailCorrespondence messages={THREAD} />);
    const outgoing = container.querySelectorAll("details")[1];
    expect(outgoing).toHaveTextContent(he.emailDraft.systemSender);
    expect(outgoing).toHaveTextContent(he.emailDraft.sentTo);
    expect(outgoing.querySelector('bdi[dir="ltr"]')).toHaveTextContent("dana@example.com");
  });

  it("מייל שלא נקלט נושא את הסיבה במילים; מייל שנקלט — בלי שורת הערה", () => {
    const { container } = render(<EmailCorrespondence messages={THREAD} />);
    const [created, , notPermitted] = container.querySelectorAll("details");
    expect(within(notPermitted as HTMLElement).getByText(he.emailDraft.outcome.REPLY_NOT_PERMITTED)).toHaveClass(
      "text-danger",
    );
    for (const note of Object.values(he.emailDraft.outcome)) {
      expect(created).not.toHaveTextContent(note);
    }
  });

  it("קישור רק לקובץ שיש לו בתים; לשאר — שם, גודל והסיבה במילים", () => {
    render(<EmailCorrespondence messages={THREAD} />);
    expect(screen.getByRole("link", { name: "kitchen.jpg" })).toHaveAttribute("href", "/api/email-attachments/att-1");
    expect(screen.queryByRole("link", { name: "quote.xlsx" })).not.toBeInTheDocument();
    expect(screen.getByText("quote.xlsx")).toBeInTheDocument();
    expect(screen.getByText(he.emailDraft.attachmentSkipped["not-media"])).toBeInTheDocument();
    // גודל מעוגל כלפי מעלה: 300 בייט אינם "0 KB"
    expect(screen.getByText(he.emailDraft.fileSize("1"))).toBeInTheDocument();
    expect(screen.getByText(he.emailDraft.fileSize("200"))).toBeInTheDocument();
  });

  it("קובץ בלי בתים ובלי סיבה מוכרת — נוסח כללי ולא קישור", () => {
    render(
      <EmailCorrespondence
        messages={[
          message({
            id: "m9",
            attachments: [
              {
                id: "att-9",
                filename: null,
                mimeType: "application/octet-stream",
                sizeBytes: 10,
                isMedia: false,
                mediaFileId: null,
                skippedReason: "something-new",
                downloadable: false,
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(he.emailDraft.unnamedAttachment)).toBeInTheDocument();
    expect(screen.getByText(he.emailDraft.attachmentUnavailable)).toBeInTheDocument();
  });

  it("מייל יוצא שדולג: 'שוגרה או נמחקה' רק כשזו הסיבה, ובצבע של מידע ולא של תקלה", () => {
    const skipped = (id: string, skippedAfterClose: boolean) =>
      message({ id, direction: "OUTBOUND", state: "SKIPPED", outcome: null, fromName: null, skippedAfterClose });
    render(<EmailCorrespondence messages={[skipped("s1", true), skipped("s2", false)]} />);
    expect(screen.getByText(he.emailDraft.sendSkipped)).toHaveClass("text-muted");
    expect(screen.getByText(he.emailDraft.sendNotSent)).toHaveClass("text-danger");
  });

  it("כתובת בלי שם תצוגה מבודדת ב-<bdi dir='ltr'>, והנושא ב-<bdi>", () => {
    const { container } = render(
      <EmailCorrespondence messages={[message({ id: "m5", fromName: null, subject: "Re: fix 12" })]} />,
    );
    expect(container.querySelector('summary bdi[dir="ltr"]')).toHaveTextContent("dana@example.com");
    expect(container.querySelector("details div bdi")).toHaveTextContent("Re: fix 12");
  });

  it("בלי הודעות — שורה אחת ולא רשימה ריקה", () => {
    render(<EmailCorrespondence messages={[]} />);
    expect(screen.getByText(he.emailDraft.noCorrespondence)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
