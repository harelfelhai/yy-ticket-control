import { Suspense } from "react";
import { cardClasses } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Banner } from "@/components/ui/message";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { he } from "@/lib/he";
import { type WhatsappScreen, getWhatsappScreen } from "@/lib/services/wa-number";
import type { WaDelivery } from "@/lib/whatsapp/delivery";
import { CONTENT_WIDTH, LINK, PAGE_X, TITLE_DESCRIPTIVE } from "@/lib/ui";
import type { WaIssue } from "@/lib/whatsapp/connection-issue";
import { ConnectButton } from "./connect-button";
import { DisconnectButton, TestMessageButton } from "./number-actions";
import { TemplatesCard, TemplatesSection } from "./templates-section";

export const metadata = { title: `${he.whatsappAdmin.title} — ${he.app.name}` };

/**
 * מסך 17 — חיבור וואטסאפ (אפיון 1.4; DESIGN.md § מסך 17). מנהל מערכת בלבד — השער
 * ב-`(manage)/layout.tsx`, והשירות אוכף שוב בכל פעולה.
 *
 * **הקישורים מכאן ואליו הם `<a>` ולא `<Link>`.** ה-CSP של המסך הזה בלבד מתיר את
 * ה-SDK של Meta (`FACEBOOK_SDK_PATHS`), ו-CSP חל על **מסמך**: ניווט בצד הלקוח היה
 * משאיר את המדיניות של המסך הקודם, וה-SDK היה נחסם בשקט — או נשאר טעון אחרי היציאה.
 */
export default async function WhatsappAdminPage() {
  const actor = await requireUser();
  const screen = await getWhatsappScreen(actor);
  const number = screen.number;
  const connected = number?.status === "CONNECTED";

  return (
    <div className={`flex flex-col gap-3 py-3 ${PAGE_X} ${CONTENT_WIDTH}`}>
      <a href="/admin" className={`text-sm ${LINK}`}>
        ← {he.admin.title}
      </a>
      <h1 className={TITLE_DESCRIPTIVE}>{he.whatsappAdmin.title}</h1>

      <section className={cardClasses("flex flex-col gap-2")}>
        <h2 className={TITLE_DESCRIPTIVE}>{he.whatsappAdmin.statusTitle}</h2>
        {number ? <NumberStatus number={number} /> : <p className="text-sm text-muted">{he.whatsappAdmin.noNumber}</p>}

        {!screen.signup && !connected ? <Banner tone="info">{he.whatsappAdmin.errors.notConfigured}</Banner> : null}

        <div className="flex flex-wrap items-start gap-2">
          {screen.signup && !connected ? (
            <ConnectButton
              appId={screen.signup.appId}
              configId={screen.signup.configId}
              graphVersion={screen.signup.graphVersion}
            />
          ) : null}
          {number && number.status !== "DISCONNECTED" ? <DisconnectButton /> : null}
        </div>
      </section>

      {connected ? (
        <>
          <section className={cardClasses("flex flex-col gap-2")}>
            <h2 className={TITLE_DESCRIPTIVE}>{he.whatsappAdmin.testTitle}</h2>
            <Detail label={he.whatsappAdmin.testRecipient}>
              <span dir="ltr">{screen.adminPhone}</span>
            </Detail>
            <Detail label={he.whatsappAdmin.lastTest}>
              {number.lastTest ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Chip tone={DELIVERY_TONE[number.lastTest.delivery]}>
                    {he.whatsappAdmin.delivery[number.lastTest.delivery]}
                  </Chip>
                  {number.lastTest.errorCode !== null ? he.whatsappAdmin.failedCode(number.lastTest.errorCode) : null}
                  <span className="text-muted">{formatDateTime(number.lastTest.at)}</span>
                </span>
              ) : (
                he.whatsappAdmin.noTestYet
              )}
            </Detail>
            <TestMessageButton />
          </section>

          <Suspense
            fallback={
              <TemplatesCard>
                <p className="text-sm text-muted">{he.whatsappAdmin.templatesLoading}</p>
              </TemplatesCard>
            }
          >
            <TemplatesSection />
          </Suspense>
        </>
      ) : null}
    </div>
  );
}

/** DESIGN.md § מסך 17: "מנותק" אינו אדום — מנהל שניתק בכוונה אינו במצב חריג */
const STATUS_TONE: Record<"CONNECTED" | "DISCONNECTED" | "ERROR", ChipTone> = {
  CONNECTED: "success",
  DISCONNECTED: "neutral",
  ERROR: "danger",
};

const DELIVERY_TONE: Record<WaDelivery, ChipTone> = {
  sent: "neutral",
  delivered: "success",
  read: "success",
  failed: "danger",
};

function NumberStatus({ number }: { number: NonNullable<WhatsappScreen["number"]> }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold" dir="ltr">
            {number.displayPhone}
          </span>
          <Chip tone={STATUS_TONE[number.status]}>{he.whatsappAdmin.status[number.status]}</Chip>
        </p>
        {number.verifiedName ? <p className="text-sm text-muted">{number.verifiedName}</p> : null}
      </div>

      <Detail label={he.whatsappAdmin.lastMessage}>
        {number.lastMessageAt ? formatDateTime(number.lastMessageAt) : he.whatsappAdmin.noMessages}
      </Detail>
      <Detail label={he.whatsappAdmin.unidentified}>
        <span className={number.unidentified > 0 ? "font-semibold text-warning" : undefined}>{number.unidentified}</span>
      </Detail>

      {number.status === "ERROR" ? <Banner tone="danger">{issueText(number.issue)}</Banner> : null}
      {number.syncPending ? <Banner tone="info">{he.whatsappAdmin.syncPending}</Banner> : null}
    </>
  );
}

/** שורת פרט: התווית מעומעמת, והערך צמוד אחריה (DESIGN.md § Layout — בלי דחיפה לקצה) */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm">
      <span className="text-muted">{label}:</span>
      {children}
    </p>
  );
}

/** הנוסח של התקלה — מהקוד שנשמר (`whatsapp/connection-issue.ts`), לפי טבלת האפיון */
function issueText(issue: WaIssue | null): string {
  const texts = he.whatsappAdmin.issue;
  if (!issue) return he.whatsappAdmin.issueUnknown;
  if (issue.code === "partner_removed") {
    const reason = issue.reason ? he.whatsappAdmin.disconnectReason[issue.reason] : undefined;
    return texts.partner_removed(reason ?? he.whatsappAdmin.disconnectReasonUnknown);
  }
  return texts[issue.code];
}
