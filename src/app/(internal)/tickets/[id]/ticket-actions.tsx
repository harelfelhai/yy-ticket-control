"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { AddMediaButton } from "@/components/add-media-button";
import { AttachedFiles } from "@/components/attached-files";
import { AudioRecorder } from "@/components/audio-recorder";
import {
  type AttachedFile,
  toFileList,
  useMediaUpload,
} from "@/lib/use-media-upload";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/he";
import { useAction } from "@/lib/use-action";
import { PAGE_BLEED, PAGE_X } from "@/lib/ui";
import { cardClasses } from "@/components/ui/card";
import { replyAction } from "./actions";
import { FormError } from "@/components/ui/message";
import { ReplyField } from "@/components/reply-field";

interface TicketActionsProps {
  ticketId: string;
  canComment: boolean;
}

/**
 * תיבת התגובה — שורה אחת, צמודה לתחתית.
 *
 * **פעולות הפנייה אינן כאן מ-0.6.** הן עלו לפס העליון
 * (`ticket-header-actions`), ואיתן ירדו מכאן גם `useAction` והודעות המצב
 * שלהן: מה שנשאר הוא קומפוזר, וכל מצבו יושב ב-`useMediaUpload`.
 */
export function TicketActions({ ticketId, canComment }: TicketActionsProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [recording, setRecording] = useState(false);
  const { busy, error, run } = useAction();
  const media = useMediaUpload({ ticketId, files, onChange: setFiles, disabled: busy });

  // תמונה בלי כיתוב היא הודעה שלמה — ולעיתים המדויקת ביותר.
  const canSend = text.trim().length > 0 || files.length > 0;

  return (
    /*
     * צמוד לתחתית (אפיון מסך 2 אזור ד׳, DESIGN.md § אלמנט דביק).
     *
     * בשרשור ארוך התיבה הייתה נופלת מתחת לקיפול, והמשתמש נאלץ לגלול לסוף
     * כדי לענות — בדיוק ההפך ממה שצ׳אט אמור לעשות. ‏`PAGE_BLEED` + `PAGE_X`
     * מותחים את הרצועה לקצה המסך, אחרת ההודעות זולגות בצדדים מתחתיה.
     *
     * **הבליטה מגיעה מהקבוע ולא מ-`-mx-4` כתוב ביד**, ומאותה סיבה שהכותרת
     * הדביקה במסך הפנייה עברה אליו: שתי הרצועות חייבות להסכים עם ריפוד
     * העמוד, ומספר שנכתב פעמיים כבר סטה כאן פעם אחת (הריפוד ירד ל-12px
     * והבליטה נשארה 16px, כלומר 4px שהתוכן זולג דרכם משני הצדדים).
     *
     * **פעולות הפנייה נשארות ברצועה ולא בפאנל**: תוכן של `<details>` סגור
     * מוסר מעץ הנגישות, וסגירת פנייה אינה פרט מנהלי אלא התוצאה של המסך.
     */
    <div
      className={`sticky bottom-0 z-[1] ${PAGE_BLEED} flex flex-col gap-3 border-t border-border bg-bg ${PAGE_X} py-3`}
    >
      {/*
       * **פעולות הפנייה ירדו מכאן ב-0.6 ועלו לפס העליון** (אפיון §7 שורה 35).
       *
       * הנימוק שהיה כתוב כאן — "הן על הפנייה כולה, בעוד שהקומפוזר מוסיף לה
       * הודעה; הסמיכות לתיבת הכתיבה הייתה קוראת אותן כחלק ממנה" — **הוא
       * בדיוק מה שהוליד את המעבר**: הוא נכון, והמסקנה שנגזרה ממנו (רצועה
       * נפרדת מעליה) הייתה המקום השגוי לקיים אותו. ראו `ticket-header-actions`.
       *
       * מה שנשאר כאן הוא שורה אחת.
       */}
      {canComment ? (
        /*
         * **שורת הקלטה אחת** (סבב הצ׳אט).
         *
         * קודם ישבו כאן ארבע שכבות זו מעל זו — תווית, תיבה בת שלוש שורות
         * קבועות, שורת שלושה כפתורי מדיה בטקסט, וכפתור "שלח" מתחתם — כלומר
         * הקומפוזר גזל מהשרשור יותר גובה מכפי שהשרשור נותן להודעות. עכשיו
         * הכול בשורה אחת, כמו בכל אפליקציית שיחה.
         *
         * ‏`items-end` ולא `items-center`: התיבה גדלה כלפי מעלה עם התוכן,
         * והאייקונים חייבים להישאר מיושרים לתחתיתה — במרכוז הם היו נודדים
         * למעלה עם כל שורה שנוספת.
         *
         * ‏`MediaPicker` מחזיק בתוכו גם את התצוגות המקדימות של הקבצים,
         * שנפרשות מעליו כשיש קבצים — ולכן הוא כאן ולא מפוצל.
         */
        <div className={cardClasses("flex flex-col gap-2")}>
          <AttachedFiles media={media} />

          <div className="flex items-end gap-2">
            {recording ? null : <AddMediaButton media={media} />}

            {/* `flex-1` על עטיפה ולא על השדה: `Textarea` נושא `w-full` משלו,
                וההתמתחות היא תפקיד של התא בשורה. */}
            {recording ? null : (
              <div className="flex-1">
                <ReplyField value={text} onChange={setText} />
              </div>
            )}

            {/*
             * מוצג רק כשיש מה לשלוח — ובמקומו יושב המיקרופון.
             *
             * **הסתרה ולא `disabled`, ובכוונה.** כפתור מושבת תופס את מקומו
             * ברוחב בלי לתת דבר, וזה בדיוק המשאב שחסר בשורה של 393px. שני
             * המצבים מוציאים זה את זה ממילא: אין רגע שבו המשתמש רוצה גם
             * להקליט וגם לשלוח את מה שכתב.
             */}
            {canSend && !recording ? (
              <Button
                size="compact"
                disabled={busy}
                aria-label={he.ticket.send}
                onClick={() =>
                  run(
                    () => replyAction(ticketId, text, files.map((f) => f.mediaId)),
                    () => {
                      setText("");
                      setFiles([]);
                    },
                  )
                }
              >
                <Send className="size-3" aria-hidden="true" />
              </Button>
            ) : null}

            {/* **אלמנט אחד במיקום קבוע**, ולא ענף מול כפתור השליחה — ראו
                ההסבר על `hidden` ב-`audio-recorder`: החלפה בענפים מפרקת
                אותו וההקלטה מתה באמצע. */}
            <AudioRecorder
              icon
              hidden={canSend}
              disabled={media.busy}
              onRecordingChange={setRecording}
              onRecorded={(file) => void media.addFiles(toFileList(file))}
              onError={media.setError}
            />
          </div>

          {media.error ? <FormError>{media.error}</FormError> : null}
        </div>
      ) : (
        <p className={cardClasses("text-sm text-muted")}>
          {he.notices.closedTicketBlocked}
        </p>
      )}

      {error ? (
        <FormError>
          {error}
        </FormError>
      ) : null}
    </div>
  );
}
