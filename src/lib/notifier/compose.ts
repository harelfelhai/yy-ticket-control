import { he } from "@/lib/he";
import type { ComposeInput, ComposedMessage, TicketSummary } from "./types";

/**
 * ניסוח ההודעה היוצאת — פונקציה טהורה, ללא DB וללא רשת.
 *
 * ההפרדה הזו היא מה שמאפשר לבדוק את הנוסח עצמו: מה שנשלח לקבלן אמיתי הוא
 * הדבר הכי בלתי הפיך במערכת, ובדיקה שדורשת חיבור לשירות מייל לא הייתה
 * נכתבת בפועל.
 *
 * אותו גוף הודעה משמש את המייל ואת הוואטסאפ. ראה `he.notify` להסבר למה.
 */

/** שורת המיקום: "בניין א דירה 3, חשמל" */
export function ticketLocation(ticket: TicketSummary): string {
  return he.notify.location(ticket.buildingName, ticket.apartmentNumber, ticket.domainName);
}

export function composeNotification(input: ComposeInput): ComposedMessage {
  const location = ticketLocation(input.ticket);
  const ref = he.notify.ref(input.ticket.seq);
  const actor = input.actorName ?? "";

  const { subject, opening } = headline(input, location, ref, actor);

  // הרכבה משורות ולא ממחרוזת אחת: חלק מהחלקים אופציונליים (תיאור ריק,
  // שאלה בלי טקסט), והשמטה שלהם לא אמורה להשאיר שורות ריקות באמצע.
  const paragraphs = [opening, input.note?.trim(), body(input), he.notify.linkLine(input.link)];

  return {
    subject,
    body: paragraphs.filter((part): part is string => Boolean(part)).join("\n\n"),
  };
}

function headline(
  input: ComposeInput,
  location: string,
  ref: string,
  actor: string,
): { subject: string; opening: string } {
  switch (input.event) {
    case "ASSIGNED":
      return {
        subject: he.notify.assignedSubject(location),
        opening: he.notify.assigned(input.toName, location),
      };
    case "REOPENED":
      return {
        subject: he.notify.reopenedSubject(location),
        opening: he.notify.reopened(input.toName, location),
      };
    case "QUESTION":
      return {
        subject: he.notify.questionSubject(actor, location),
        opening: he.notify.question(actor, ref, location),
      };
    case "DONE":
      return {
        subject: he.notify.doneSubject(actor, location),
        opening: he.notify.done(actor, ref, location),
      };
  }
}

/**
 * תיאור הפנייה, לנמען שעוד לא ראה אותה.
 *
 * לפותח אין מה לצרף — הוא כתב אותו בעצמו, והוא נכנס לפנייה כדי לענות.
 * לקבלן זה ההבדל בין "יש לי פנייה, אבדוק אחר כך" לבין "צריך סולם, אקח
 * אותו עכשיו" — והוא קורא את זה בוואטסאפ לפני שהוא פותח קישור כלשהו.
 */
function body(input: ComposeInput): string | undefined {
  if (input.event === "QUESTION" || input.event === "DONE") return undefined;
  return input.ticket.description.trim() || undefined;
}

/**
 * עוטף את גוף הטקסט ב-HTML לקריאה בתיבת מייל.
 *
 * סגנון מוטבע (inline) ולא גיליון סגנונות: לקוחות מייל רבים מסירים תגית
 * `<style>` שלמה, ואז ההודעה מוצגת משמאל לימין ומתפרקת בעברית.
 */
export function renderEmailHtml(message: ComposedMessage): string {
  const paragraphs = message.body
    .split("\n\n")
    .map((paragraph) => `<p style="margin:0 0 12px">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return [
    `<div dir="rtl" lang="he" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#111;text-align:right">`,
    `<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(message.subject)}</h1>`,
    paragraphs,
    `<p style="margin:24px 0 0;font-size:13px;color:#666">${escapeHtml(he.notify.emailFooter)}</p>`,
    `</div>`,
  ].join("");
}

/**
 * תיאור פנייה הוא טקסט חופשי שאדם הקליד, והוא נכנס להודעה שנשלחת החוצה.
 * בלי בריחה, תיאור שמכיל `<` שובר את המבנה — ובמקרה הגרוע מחדיר תוכן זר
 * לתיבת המייל של הנמען.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
