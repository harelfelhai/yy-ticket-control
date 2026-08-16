import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MediaAttachments } from "@/components/media-attachments";
import { he } from "@/lib/he";
import type { MediaView } from "@/lib/media-view";

/**
 * הודעה שיש בה **הקלטה בלבד** — המקרה שכל הבדיקות הקיימות פספסו.
 *
 * ‏`br-edge-cases.spec.ts` כן שולח אודיו, אבל תמיד יחד עם טקסט; הטקסט מותח את
 * הבועה ל-`max-w-96` והנגן נראה תקין. בלעדיו הבועה מתכווצת לחותמת השעה, נגן
 * ב-`w-full` נמתח ל-100% ממנה, ומה שנשאר על המסך הוא כפתור ה-⋮ של Chrome.
 * ‏`toBeVisible()` עובר בירוק גם על נגן ברוחב 45px, ולכן הטענה כאן היא על
 * **המחלקה** — היא הדבר היחיד שאפשר למדוד ב-jsdom, שאינו מחשב פריסה.
 */

const audio = (over: Partial<MediaView> = {}): MediaView => ({
  id: "m1",
  url: "/api/media/m1",
  mimeType: "audio/webm;codecs=opus",
  name: "הקלטה קולית.webm",
  aiText: null,
  aiNote: null,
  ...over,
});

describe("MediaAttachments — הקלטה", () => {
  it("התווית 'הקלטה קולית' נראית ואינה `aria-label` בלבד", () => {
    render(<MediaAttachments media={[audio()]} />);

    // ‏getByText ולא getByLabelText: הטענה היא שהמילים על המסך, לא רק בעץ הנגישות.
    expect(screen.getByText(he.media.audioLabel)).toBeInTheDocument();
  });

  it("הנגן ברוחב מוחלט — `w-full` הוא בדיוק מה שהתקלה הייתה", () => {
    const { container } = render(<MediaAttachments media={[audio()]} />);
    const player = container.querySelector("audio");

    expect(player).not.toBeNull();
    // ‏classList ולא `toContain` על המחרוזת: `max-w-full` מכיל את "w-full"
    // כתת-מחרוזת, והטענה הייתה נכשלת על המחלקה הנכונה.
    expect(player?.classList.contains("w-72")).toBe(true);
    expect(player?.classList.contains("w-full")).toBe(false);
  });

  it("התווית מקושרת לנגן, ובלי כפילות ב-`aria-label`", () => {
    const { container } = render(<MediaAttachments media={[audio({ id: "abc" })]} />);
    const player = container.querySelector("audio");

    const labelId = player?.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(player?.hasAttribute("aria-label")).toBe(false);
    expect(container.querySelector(`#${labelId}`)?.textContent).toBe(he.media.audioLabel);
  });

  it("שתי הקלטות באותה הודעה — לכל אחת תווית משלה", () => {
    // ‏id קבוע היה מקשר את שני הנגנים לאותה תווית, ו-DOM עם שני מזהים זהים
    // הוא בדיוק סוג הבאג ששקט בו: הכול נראה תקין והנגישות שבורה.
    const { container } = render(
      <MediaAttachments media={[audio({ id: "a" }), audio({ id: "b" })]} />,
    );

    const ids = [...container.querySelectorAll("audio")].map((el) =>
      el.getAttribute("aria-labelledby"),
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("התמלול מוצג **מתחת** לנגן ולא לצידו", () => {
    /*
     * ‏S2-05. האפיון כתב עד 0.5 "עם התמלול מוצג לצידו", והמימוש מציג אותו
     * מתחת מאז 0.1 — סתירה ששרדה ארבע גרסאות מפני שהשורה מעולם לא אומתה.
     * ב-0.5 **האפיון תוקן**, כי פריסה דו-טורית אינה בת-מימוש בבועה ברוחב
     * 384px שהנגן תופס 288 מהם. הבדיקה הזו היא מה שהופך את הכיוון לאכיף.
     */
    const { container } = render(
      <MediaAttachments media={[audio({ aiText: "אין חשמל בממ״ד" })]} />,
    );

    const player = container.querySelector("audio") as Element;
    const transcript = screen.getByText(/אין חשמל בממ״ד/);

    // ‏DOCUMENT_POSITION_FOLLOWING: התמלול בא **אחרי** הנגן בסדר ה-DOM.
    expect(player.compareDocumentPosition(transcript) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // ובעמודה אחת — האב הוא `flex-col`, כלומר אין כאן שני טורים.
    expect(transcript.parentElement?.className).toContain("flex-col");
  });

  it("תמונה נשארת `w-full` — יש לה מידות אינטרינזיות והבועה נמתחת אליהן", () => {
    const { container } = render(
      <MediaAttachments media={[audio({ mimeType: "image/jpeg", name: "צילום.jpg" })]} />,
    );

    expect(container.querySelector("img")?.className).toContain("w-full");
  });
});
