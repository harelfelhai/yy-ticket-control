import "dotenv/config";

/**
 * הרצה בפועל של צינור ההתראות מול שרת חי.
 *
 * הבדיקות האוטומטיות קוראות ל-`drainJobs` ישירות. הסקריפט הזה בודק את מה
 * שהן **לא** בודקות: שהעובד באמת עולה עם השרת (`instrumentation.ts`),
 * מוצא לבד את העבודה שנוצרה, ומוציא ממנה הודעה.
 *
 * הרצה: הפעל `npm run dev`, ואז `npx tsx scripts/smoke-notify.mts`.
 * ההודעה תופיע בלוג של שרת הפיתוח, מסומנת ב-[notifier].
 */

const { db } = await import("../src/lib/db.ts");
const { createTicket } = await import("../src/lib/services/tickets.ts");

const stamp = Date.now();
const manager = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
const site = await db.site.findFirstOrThrow();
const building = await db.building.findFirstOrThrow({ where: { siteId: site.id } });
const apartment = await db.apartment.findFirstOrThrow({ where: { buildingId: building.id } });
const domain = await db.domain.findFirstOrThrow();

const professional = await db.professional.create({
  data: {
    name: `קבלן בדיקה ${stamp}`,
    phone: `050${String(stamp).slice(-7)}`,
    email: `contractor-${stamp}@example.com`,
  },
});

const { ticket } = await createTicket(
  { id: manager.id, name: manager.name, role: manager.role, siteId: manager.siteId },
  {
    siteId: site.id,
    buildingId: building.id,
    apartmentId: apartment.id,
    domainId: domain.id,
    description: "אין חשמל בסלון מאז אתמול",
    recipients: [{ kind: "professional", id: professional.id }],
  },
);

console.log(`נוצרה פנייה #${ticket.seq} עבור ${professional.name}`);
console.log("ממתין לעובד שירים אותה מהתור…");

const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const assignment = await db.assignment.findFirstOrThrow({ where: { ticketId: ticket.id } });
  if (assignment.notifiedAt) {
    console.log(`✔ ההודעה יצאה בשעה ${assignment.notifiedAt.toISOString()}`);
    console.log("  הטקסט המלא מופיע בלוג של שרת הפיתוח, מסומן ב-[notifier].");
    await db.$disconnect();
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error("✖ העובד לא סימן את השיוך כמיודע תוך 30 שניות");
await db.$disconnect();
process.exit(1);
