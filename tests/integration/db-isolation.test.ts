import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSoleDbClient,
  foreignDbClients,
  foreignDbClientsMessage,
  staleForeignClients,
  type ForeignDbClient,
} from "../../e2e/global-setup";

/**
 * **השומר שמונע מתהליך זר להריץ את הג׳ובים של הבדיקות.**
 *
 * הנימוק המלא יושב ב-`assertSoleDbClient` שב-`e2e/global-setup.ts`; בקצרה:
 * לכל שרת של המערכת יש עובד תור **בתוך התהליך**, והתור הוא טבלה בבסיס.
 * שרת נשכח שמחובר לבסיס הבדיקות ממשיך אפוא לתפוס ג׳ובים ולהריץ אותם עם
 * הסביבה והקוד **שלו** — וזה בדיוק מה שקרה ב-7.9.2026 והפיל את
 * `media.spec.ts` על טענה שנראתה כמו באג בקוד.
 *
 * **הקריטריון הוא גיל.** שרת הבדיקות שמעלה Playwright מתחבר לבסיס לפני
 * ה-globalSetup, ולכן הוא תמיד נוכח; מה שמבדיל אותו משרת נשכח הוא שהוא
 * צעיר מתהליך הריצה. שתי הבדיקות המרכזיות כאן הן שני צדי הגבול הזה.
 *
 * הבדיקה רצה מול `yy_test` ולא מול `yy_e2e` (זה הבסיס של האינטגרציה), וזה
 * חסר משמעות: הפונקציה שואלת את `pg_stat_activity` של **הבסיס שאליו היא
 * מחוברת**.
 *
 * **אין כאן טענה על מספר החיבורים.** בסביבת האינטגרציה עשויים לחיות גם
 * חיבורים של בריכת Prisma, ולכן הטענות הן על נוכחות מזהה מסוים ברשימה —
 * לא על אורכה.
 */

const URL = process.env.TEST_DATABASE_URL as string;

const open: Client[] = [];

async function connect(): Promise<{ client: Client; pid: number }> {
  const client = new Client({ connectionString: URL });
  await client.connect();
  open.push(client);
  const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
  return { client, pid: rows[0]!.pid };
}

function row(overrides: Partial<ForeignDbClient> = {}): ForeignDbClient {
  return {
    pid: 4242,
    clientPort: 51798,
    applicationName: "",
    backendStart: new Date("2026-09-04T10:40:53.924Z"),
    ageSeconds: 0,
    ...overrides,
  };
}

afterEach(async () => {
  delete process.env.E2E_ALLOW_FOREIGN_DB_CLIENTS;
  while (open.length > 0) {
    await open.pop()?.end().catch(() => {});
  }
});

describe("בסיס הבדיקות חייב להיות שלנו בלבד", () => {
  it("`foreignDbClients` רואה חיבור אחר, אינו סופר את עצמו, ומודד גיל", async () => {
    const observer = await connect();
    const intruder = await connect();

    const clients = await foreignDbClients(observer.client);
    const found = clients.find((client) => client.pid === intruder.pid);

    expect(found, "החיבור השני אינו ברשימה").toBeDefined();
    expect(clients.map((client) => client.pid)).not.toContain(observer.pid);
    // נולד זה עתה — הגיל נמדד על שעון בסיס הנתונים ולא על שעון התהליך.
    expect(found!.ageSeconds).toBeLessThan(10);
  });

  it("החיבור נעלם מהרשימה כשהוא נסגר", async () => {
    const observer = await connect();
    const intruder = await connect();

    expect((await foreignDbClients(observer.client)).map((client) => client.pid)).toContain(
      intruder.pid,
    );

    await intruder.client.end();
    open.splice(open.indexOf(intruder.client), 1);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const clients = await foreignDbClients(observer.client);
      if (!clients.some((client) => client.pid === intruder.pid)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`החיבור ${intruder.pid} עדיין מופיע ב-pg_stat_activity אחרי 5 שניות`);
  });

  it("שרת שעלה עם הריצה עובר — זה שרת הבדיקות עצמו", async () => {
    /**
     * הכשל שהתגלה ברגע שהשומר נכתב: Playwright מעלה את `webServer` **לפני**
     * ה-globalSetup, ולכן העובד שלו כבר מחובר. כלל של "אף חיבור זר" חסם
     * כל ריצה, כולל ריצה תקינה לחלוטין.
     */
    const observer = await connect();
    await connect();

    await expect(assertSoleDbClient(observer.client)).resolves.toBeUndefined();
  });

  it("חיבור ותיק נכשל, וההודעה מצביעה על התהליך", async () => {
    const observer = await connect();
    const intruder = await connect();

    // סף 0 הופך כל חיבור חי ל"ותיק" — כך נבדק הצד השני של אותו גבול,
    // בלי להמתין דקות עד שייווצר חיבור ותיק באמת.
    await expect(assertSoleDbClient(observer.client, 0)).rejects.toThrow(
      new RegExp(`pid ${intruder.pid}\\b`),
    );
  });

  it("מתג המילוט מדלג על הבדיקה", async () => {
    const observer = await connect();
    await connect();

    process.env.E2E_ALLOW_FOREIGN_DB_CLIENTS = "1";

    await expect(assertSoleDbClient(observer.client, 0)).resolves.toBeUndefined();
  });

  it("`staleForeignClients` חותך בדיוק בסף", () => {
    const clients = [
      row({ pid: 1, ageSeconds: 9 }),
      row({ pid: 2, ageSeconds: 10 }),
      row({ pid: 3, ageSeconds: 11 }),
    ];

    expect(staleForeignClients(clients, 10).map((client) => client.pid)).toEqual([3]);
  });

  it("ההודעה נותנת דרך פעולה ולא רק תלונה", () => {
    const message = foreignDbClientsMessage([row({ ageSeconds: 3600 })]);

    // המזהה, הדרך למצוא את התהליך, והמוצא למי שהחיבור שלו מכוון.
    expect(message).toContain("pid 4242");
    expect(message).toContain("netstat -ano | findstr 51798");
    expect(message).toContain("2026-09-04T10:40:53.924Z");
    expect(message).toContain("E2E_ALLOW_FOREIGN_DB_CLIENTS=1");
  });
});
