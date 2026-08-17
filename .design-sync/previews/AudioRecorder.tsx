import { AudioRecorder } from "yy-ticket-control";

/**
 * הקלטת הודעה קולית מהשטח. מנהל עבודה עם כפפות מקליט מהר יותר משהוא
 * מקליד, וההקלטה נשלחת לתמלול אוטומטי.
 *
 * מצב ההקלטה עצמו הוא אינטראקציה ואינו נלכד בתצוגה סטטית — כאן נראה מצב
 * המנוחה, שהוא מה שהמשתמש רואה ברוב הזמן.
 */
export function Idle() {
  return <AudioRecorder onRecorded={() => {}} onError={() => {}} />;
}

/** מושבת — בזמן שליחה של הפנייה. */
export function Disabled() {
  return <AudioRecorder onRecorded={() => {}} onError={() => {}} disabled />;
}

/** לצד שאר פקדי הצירוף בטופס. */
export function InToolbar() {
  return (
    <div className="flex max-w-sm flex-wrap items-center gap-2">
      <AudioRecorder onRecorded={() => {}} onError={() => {}} />
      <span className="text-sm text-muted">או צרפו תמונה מהגלריה</span>
    </div>
  );
}
