"use client";

import { useState } from "react";
import { AssignmentStatusChip } from "@/components/status-chip";
import { LearnedSelect } from "@/components/learned-select";
import { ProfessionalCreateForm } from "@/components/professional-create-form";
import { openWhatsAppTab } from "@/components/wa-pending-panel";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { unwrapOrThrow } from "@/lib/action-result";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { createProfessionalAction } from "../new/actions";
import { CARD_LIST, TITLE_DESCRIPTIVE } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import {
  addRecipientsAction,
  getLinkAction,
  removeRecipientAction,
  resendEmailAction,
  rotateLinkAction,
} from "./actions";
import { FormError, FormNotice } from "@/components/ui/message";

export interface AssignmentRow {
  id: string;
  name: string;
  status: AssignmentStatus;
  /** null עבור נמען פנימי — הוא נכנס עם סיסמה ואינו צריך קישור */
  professionalId: string | null;
  /** מצב השליחה האוטומטית אליו, כטקסט מוכן */
  deliveryNote: string;
  /** כתובת wa.me עם ההודעה מוכנה, או null כשאין טלפון */
  waUrl: string | null;
  /** האם יש כתובת מייל שאפשר לשלוח אליה שוב */
  canResendEmail: boolean;
  /** לא יקבל שום הודעה עד שמישהו יפתח עבורו את הוואטסאפ */
  waPending: boolean;
  /** מתי השתנה הסטטוס האישי לאחרונה, כטקסט מוכן */
  statusChangedAt: string;
}

export interface AvailableRecipient {
  id: string;
  label: string;
  hint?: string;
  kind: "professional" | "user";
  /** אין לו מייל — הוספתו פותחת וואטסאפ (§5.ה2, ראה `RecipientOption`) */
  needsWhatsApp?: boolean;
}

interface RecipientEditorProps {
  ticketId: string;
  /** אתר הפנייה — נדרש ליצירת איש מקצוע חדש מתוך העורך */
  siteId: string;
  assignments: AssignmentRow[];
  available: AvailableRecipient[];
  canEdit: boolean;
}

/**
 * רצועת הנמענים: מי משויך, מה הסטטוס האישי שלו, והאם הוא בכלל יודע.
 *
 * ההפרדה בין שני האחרונים היא העיקר. "נשלח" הוא סטטוס השיוך — הוא אומר
 * שהמערכת שייכה אותו, לא שמישהו יידע אותו. שורת השליחה שמתחתיו אומרת את
 * הדבר השני, וההבחנה הזו היא ההבדל בין מנהל שיודע שהקבלן קיבל לבין מנהל
 * שמניח שכן.
 *
 * שיוך שהוסר נשאר מוצג באפור: המידע ההיסטורי חשוב ("שלחתי לו והוא לא
 * הגיב"), אבל ברור שהוא כבר לא בתמונה.
 */
export function RecipientEditor({
  ticketId,
  siteId,
  assignments,
  available,
  canEdit,
}: RecipientEditorProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [link, setLink] = useState<{ forId: string; url: string; rotated: boolean } | null>(null);
  const { busy, error, run } = useAction();

  const active = assignments.filter((a) => a.status !== "REMOVED");
  const removed = assignments.filter((a) => a.status === "REMOVED");

  function showLink(professionalId: string) {
    // מנקים את הקישור הקודם **לפני** הבקשה: אחרת, בזמן הטעינה עבור הקבלן
    // השני התיבה עדיין מציגה את הקישור של הראשון, והמנהל עלול להעתיק
    // ולשלוח לאחד את הקישור האישי של האחר.
    setLink(null);
    run(
      () => getLinkAction(ticketId, professionalId),
      (url) => setLink({ forId: professionalId, url, rotated: false }),
    );
  }

  function rotate(professionalId: string) {
    if (!confirm(he.ticket.confirmRotateLink)) return;
    setLink(null);
    run(
      () => rotateLinkAction(ticketId, professionalId),
      (url) => setLink({ forId: professionalId, url, rotated: true }),
    );
  }

  function add(id: string | null) {
    const option = available.find((o) => o.id === id);
    if (!option) return;
    // האזהרה מהאפיון (מסך 3): נמען שנוסף רואה את כל ההיסטוריה שקדמה לו.
    if (!window.confirm(he.ticket.confirmAddRecipient)) return;

    // הלשונית נפתחת לפני הקריאה לשרת — ראה `openWhatsAppTab` — ורק כשלנמען
    // הזה באמת אין מייל. אחרת היה נפתח ונסגר חלון ריק בכל הוספת נמען.
    const settleWhatsApp = option.needsWhatsApp ? openWhatsAppTab() : null;

    run(
      async () => {
        const result = await addRecipientsAction(
          ticketId,
          [{ kind: option.kind, id: option.id }],
          settleWhatsApp?.opened === true,
        );
        if (!result.ok) settleWhatsApp?.(null);
        return result;
      },
      (assignmentId) => settleWhatsApp?.(assignmentId),
    );
  }

  function remove(assignmentId: string, name: string) {
    // האזהרה מהאפיון (מסך 3): הפנייה תיעלם מהרשימה שלו, אך תגובותיו יישארו.
    if (!window.confirm(he.ticket.confirmRemoveRecipient(name))) return;
    run(() => removeRecipientAction(ticketId, assignmentId));
  }

  function resend(assignmentId: string, name: string) {
    setNotice(null);
    run(
      () => resendEmailAction(ticketId, assignmentId),
      () => setNotice(he.ticket.linkResent(name)),
    );
  }

  /**
   * יוצר איש מקצוע חדש ומשייך אותו מיד לפנייה.
   *
   * בלי דיאלוג ה-confirmAddRecipient בכוונה: יצירת איש מקצוע בתוך העורך של
   * הפנייה הזו היא כבר פעולה מכוונת ומפורשת — האזהרה נחוצה כשמוסיפים נמען
   * קיים מהרשימה, שם טעות-בחירה אפשרית. זורק כדי שהטופס יציג את השגיאה.
   */
  async function createAndAdd(input: { name: string; phone: string; email: string }) {
    /*
     * **הלשונית נפתחת בשורה הראשונה, לפני כל `await`.**
     *
     * ‏`ProfessionalCreateForm` קורא ל-`onCreate` בלי המתנה שקדמה לו,
     * ולכן השורה הזו עדיין רצה בתוך אירוע הלחיצה — החלון היחיד שבו הדפדפן
     * מתיר `window.open`. שורה אחת למטה, אחרי ה-`await` הראשון, זה כבר
     * חלון קופץ חסום.
     *
     * וזה **המסלול שהכי צריך אותו**: איש מקצוע שנוצר כאן בשטח נרשם לרוב
     * עם טלפון בלבד.
     */
    /*
     * **הלשונית נפתחת לפי מה שהוקלד, והשרת מכריע אחריו.**
     *
     * ‏`window.open` חייב לרוץ לפני ה-`await` הראשון, ובאותו רגע התשובה
     * היחידה שיש היא הטופס. ‏`findOrCreateProfessional` עשויה להחזיר איש
     * מקצוע **קיים** עם מייל שהמקליד לא ידע עליו — ואז `needsWhatsApp`
     * חוזר `false`, `claimWhatsAppAutoOpen` אינו מסמן דבר, והלשונית
     * נסגרת. כלומר: פותחים בספק, וסוגרים בידיעה.
     */
    const settleWhatsApp = input.email.trim() ? null : openWhatsAppTab();

    try {
      const created = unwrapOrThrow(await createProfessionalAction(siteId, input));
      if (!created.needsWhatsApp) settleWhatsApp?.(null);
      const waAutoOpen = unwrapOrThrow(
        await addRecipientsAction(
          ticketId,
          [{ kind: "professional", id: created.id }],
          created.needsWhatsApp && settleWhatsApp?.opened === true,
        ),
      );
      if (created.needsWhatsApp) settleWhatsApp?.(waAutoOpen);
      setShowCreate(false);
    } catch (failure) {
      settleWhatsApp?.(null);
      // נזרק הלאה כדי שהטופס יציג את השגיאה, כפי שהיה לפני הלשונית.
      throw failure;
    }
  }

  return (
    /*
     * **‏`cardClasses` ירד מכאן ב-0.6.** הסקציה יושבת בתוך דיאלוג "פרטים",
     * שהוא בעצמו כרטיס — כלומר היה כאן כרטיס בתוך כרטיס, ולצדו עוד אחד
     * (תגיות). שלוש מסגרות מקוננות ברוחב 448px נקראו כבלגן ולא כהיררכיה.
     * ההפרדה בין הסקציות עברה לקו אחד (`border-t`) אצל ההורה.
     */
    <section className="flex flex-col border-t border-border pt-3">
      <h2 className={`mb-2 ${TITLE_DESCRIPTIVE}`}>{he.ticket.recipients}</h2>

      {active.length === 0 ? (
        <p className="text-sm text-muted">{he.reason.noRecipients}</p>
      ) : (
        <ul aria-label={he.ticket.recipients} className={CARD_LIST}>
          {active.map((assignment) => (
            <li key={assignment.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {/* min-w-0 + truncate: שם ארוך מקצר את עצמו במקום למעוך את
                    הכפתור שלצדו. בלי זה הכפתור נמעך ל-16 פיקסלים על מסך
                    טלפון — יעד מגע בלתי אפשרי, ובפועל לחיצות מתפספסות.

                    בלי `flex-1`: הוא מתח את השם על כל הרוחב ודחף את התג ואת
                    "הסר" לקצה הנגדי, כך שברוחב דסקטופ הם נותקו מהשם שהם
                    מתייחסים אליו. `min-w-0` לבדו מספיק לכיווץ. */}
                <span className="min-w-0 truncate">{assignment.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <AssignmentStatusChip status={assignment.status} />
                  {canEdit ? (
                    <Button
                      variant="dangerQuiet"
                      size="compact"
                      disabled={busy}
                      onClick={() => remove(assignment.id, assignment.name)}
                      aria-label={`${he.ticket.removeRecipient} ${assignment.name}`}
                      // ‏`px-3` ירד: הוא ריפוד, ו-`className` ב-`Button` הוא
                      // פריסה בלבד. דריסה כזו היא בדיוק הסחיפה שהפרימיטיב
                      // נועד לעצור, והיא גם הרחיבה אותו מעבר ל-`compact`.
                      className="shrink-0"
                    >
                      {he.ticket.removeRecipient}
                    </Button>
                  ) : null}
                </span>
              </div>

              <p className="text-xs text-muted">
                {assignment.deliveryNote}
                {/* מתי השתנה הסטטוס האישי לאחרונה — לצד החיווי */}
                <span className="ms-2 opacity-70">· {assignment.statusChangedAt}</span>
              </p>

              {/*
               * **שלוש הפעולות בשורה אחת** (0.6).
               *
               * "שלח שוב במייל" ישב עד כאן בשורה משלו עם `self-start`, ולכן
               * כל נמען תפס **ארבע** שורות: שם, חיווי, מייל, ואז שני כפתורי
               * הקישור. הכפתורים עצמם היו `compact` ממילא — מה שהגדיל את
               * הפאנל היה הערימה, לא המידה.
               *
               * "שלח שוב במייל" רלוונטי לכל נמען עם כתובת מייל (חיצוני או
               * פנימי), בשונה משני כפתורי הקישור שרלוונטיים רק לקבלן חיצוני
               * — ולכן התנאי על העטיפה הוא איחוד ולא חיתוך.
               */}
              {canEdit && (assignment.canResendEmail || assignment.professionalId) ? (
                <div className="flex flex-wrap gap-2">
                  {assignment.canResendEmail ? (
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={busy}
                      onClick={() => resend(assignment.id, assignment.name)}
                    >
                      {he.ticket.resendEmail}
                    </Button>
                  ) : null}

                  {/* קישור רגיל ולא כפתור: הוא חייב לפתוח את וואטסאפ ישירות
                      מלחיצת המשתמש. פתיחה מתוך תשובה אסינכרונית נחסמת
                      כחלון קופץ — בדיוק בדפדפני המובייל שבהם זה נחוץ. */}
                  {assignment.waUrl ? (
                    <a
                      href={assignment.waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${he.ticket.sendWhatsApp} ${assignment.name}`}
                      className={buttonClasses("primary", "compact")}
                    >
                      {he.ticket.sendWhatsApp}
                    </a>
                  ) : null}
                  {/*
                   * **התנאי על `professionalId` נדרש מאז שהעטיפה אוחדה.**
                   * קודם הוא ישב על ה-`<div>` כולו; עכשיו העטיפה נפתחת גם
                   * ל"שלח שוב במייל" בלבד, ובלי התנאי הזה נמען **פנימי** עם
                   * מייל היה מקבל "קישור גישה" — קישור קסם למי שאינו קבלן
                   * חיצוני. ‏`e2e/self-reminder.spec.ts` בודק בדיוק את זה.
                   */}
                  {assignment.professionalId ? (
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={busy}
                      onClick={() => showLink(assignment.professionalId as string)}
                      aria-label={`${he.ticket.showLink} ${assignment.name}`}
                    >
                      {he.ticket.showLink}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {link !== null && link.forId === assignment.professionalId ? (
                /*
                 * הפאנל שנפתח עם קישור הקסם — כרטיס מקונן, מהפרימיטיב.
                 *
                 * היה כאן `border-brand/30 bg-brand/5` בכתיבה ידנית, ושתי
                 * בעיות נפגשו בו: `/5` אינו ערך שהתקן מתיר (‏`/10` לרקע,
                 * ‏`/30` למסגרת), ובפלטת הגרפיט הגוון ממילא נקרא כאפור —
                 * כלומר הצביעה לא קנתה דבר. הפאנל אינו מצב ואינו התראה אלא
                 * **מידע שנחשף לבקשה**, ולכן משטח נייטרלי הוא הקריאה הנכונה
                 * שלו; `cardClasses` נותן גם את `rounded-md` שהחליף את
                 * ה-`rounded-xl` בסקאלת הצורות החדשה.
                 */
                <div className={cardClasses("flex flex-col gap-2")}>
                  <p className="text-sm font-medium">{he.ticket.linkFor(assignment.name)}</p>
                  <p className="text-xs text-muted">
                    {link.rotated ? he.ticket.linkRotated : he.ticket.linkStable}
                  </p>
                  {/* readOnly ולא טקסט רגיל: בחירה והעתקה ידנית עובדות בכל
                      מכשיר, גם כשה-clipboard API חסום או שאינו נתמך. */}
                  <Input
                    readOnly
                    dir="ltr"
                    value={link.url}
                    aria-label={he.ticket.showLink}
                    onFocus={(e) => e.currentTarget.select()}
                    size="compact"
                  />
                  <Button
                    variant="dangerQuiet"
                    size="compact"
                    disabled={busy}
                    onClick={() => rotate(assignment.professionalId as string)}
                    className="self-start px-1"
                  >
                    {he.ticket.rotateLink}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {removed.length > 0 ? (
        <ul aria-label={he.ticket.removedRecipients} className="mt-3 flex flex-col gap-1">
          {removed.map((assignment) => (
            <li key={assignment.id} className="flex items-center gap-2 text-muted">
              <span className="min-w-0 truncate line-through">{assignment.name}</span>
              <span className="shrink-0">
                <AssignmentStatusChip status={assignment.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="mt-3 flex flex-col gap-2">
          <LearnedSelect
            label={he.ticket.addRecipient}
            options={available}
            value={null}
            onChange={add}
            disabled={busy}
          />
          {showCreate ? (
            <ProfessionalCreateForm onCreate={createAndAdd} onCancel={() => setShowCreate(false)} />
          ) : (
            <Button
              variant="quiet"
              size="compact"
              disabled={busy}
              onClick={() => setShowCreate(true)}
              className="self-start px-1 text-start"
            >
              {he.directory.newProfessional}
            </Button>
          )}
        </div>
      ) : null}

      {notice ? (
        <FormNotice className="mt-2">
          {notice}
        </FormNotice>
      ) : null}

      {error ? (
        <FormError className="mt-2">
          {error}
        </FormError>
      ) : null}
    </section>
  );
}
