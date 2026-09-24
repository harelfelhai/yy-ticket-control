import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessTokenProvider, GoogleTokenError } from "@/lib/google/gmail-token";

/**
 * מטמון ה-access token של גוגל — התשתית המשותפת לשליחה (EM-12) ולקריאה
 * מהתיבה (EM-21, EM-22). אין לו שורת דרישה משלו באפיון: הוא האמצעי שבלעדיו
 * שני המסלולים האלה אינם יכולים לפנות לגוגל כלל.
 *
 * מה שנבדק כאן הוא בדיוק מה שנשבר **בשקט**:
 *
 * 1. **המטמון והשוליים.** טוקן שפג באמצע בקשה הוא כשל שמופיע פעם בשעה
 *    ואינו ניתן לשחזור. השוליים נבדקים משני צדדיהם — שנייה לפניהם ושנייה
 *    אחריהם — כי בדיקה מצד אחד בלבד עוברת גם כשהם אפס.
 * 2. **בקשה אחת לשני קוראים.** מ-1.3 יש שני צרכנים לאותו refresh token
 *    (השליחה והסבב הקורא), והם רצים באותו תהליך. בלי איחוד, כל סבב היה
 *    מנפיק שני טוקנים — והמטמון היה מקבל את זה שנענה אחרון, כלומר הקצר
 *    מבין השניים.
 * 3. **כשל אינו נדבק.** בקשה שנכשלה חייבת לפנות את מקומה, אחרת תקלת רשת
 *    אחת הייתה נועלת את שני המסלולים עד להפעלה מחדש של השרת.
 * 4. **הודעת השגיאה.** `invalid_grant` — refresh token שנשלל — הוא הכשל
 *    היחיד כאן שדורש אדם, והוא מופיע **בגוף התשובה בלבד**. `Job.lastError`
 *    שאומר "400" ותו לא אינו מאבחן דבר.
 *
 * `fetch` ו-`now` מוזרקים: הבדיקה מאמתת את החוזה שלנו מול גוגל, לא את
 * גוגל, ואין טוקן קריאה על המכונה הזו כלל.
 */

const CONFIG = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "secret",
  refreshToken: "refresh-token",
};

/** תשובת HTTP מזויפת בצורה המינימלית שהמודול נוגע בה: `ok`, `status`, `text()` */
function response(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** טוקן תקין באורך חיים שגוגל מנפיקה בפועל */
function token(accessToken: string, expiresIn = 3600) {
  return response({ access_token: accessToken, expires_in: expiresIn });
}

/** שעון ידני — הפקיעה נבדקת בקפיצות זמן, לא בהמתנה */
function clock(start = 1_000_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAccessTokenProvider", () => {
  it("מנפיק פעם אחת ומחזיר את אותו טוקן כל עוד לא פקע", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(token("t1"));
    const getToken = createAccessTokenProvider(CONFIG, { fetch: fetchSpy, now: clock().now });

    expect(await getToken()).toBe("t1");
    expect(await getToken()).toBe("t1");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("שולח refresh_token grant עם שלושת הפרטים, ל-endpoint של גוגל", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(token("t1"));

    await createAccessTokenProvider(CONFIG, { fetch: fetchSpy })();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");

    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      refresh_token: CONFIG.refreshToken,
      grant_type: "refresh_token",
    });
    // גג זמן על הבקשה: הג׳ובים מנוקזים בזו אחר זו, ובקשה שאינה חוזרת
    // עוצרת את כל מה שאחריה בתור.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("60 שניות לפני הפקיעה הטוקן עדיין נחשב תקף", async () => {
    const time = clock();
    const fetchSpy = vi.fn().mockResolvedValue(token("t1", 3600));
    const getToken = createAccessTokenProvider(CONFIG, { fetch: fetchSpy, now: time.now });

    await getToken();
    // שנייה לפני תום השוליים: עדיין מהמטמון.
    time.advance((3600 - 60) * 1000 - 1);

    expect(await getToken()).toBe("t1");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("בתוך 60 השניות האחרונות מנפיק טוקן חדש — ולא שולח טוקן שיפקע באמצע הבקשה", async () => {
    const time = clock();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(token("t1", 3600))
      .mockResolvedValueOnce(token("t2", 3600));
    const getToken = createAccessTokenProvider(CONFIG, { fetch: fetchSpy, now: time.now });

    await getToken();
    time.advance((3600 - 60) * 1000);

    expect(await getToken()).toBe("t2");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("expires_in חסר נקרא כשעה, ולא כ-0 — אחרת כל קריאה הייתה מנפיקה מחדש", async () => {
    const time = clock();
    const fetchSpy = vi.fn().mockResolvedValue(response({ access_token: "t1" }));
    const getToken = createAccessTokenProvider(CONFIG, { fetch: fetchSpy, now: time.now });

    await getToken();
    time.advance(60 * 60 * 1000 - 61_000);

    expect(await getToken()).toBe("t1");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("שני קוראים במקביל חולקים בקשה אחת", async () => {
    // התרחיש האמיתי: הסבב הקורא והשליחה מתעוררים באותו תהליך. בלי איחוד
    // היו יוצאות שתי בקשות, והמטמון היה מקבל את התשובה השנייה.
    let release!: (value: Response) => void;
    const fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const getToken = createAccessTokenProvider(CONFIG, { fetch: fetchSpy });

    const first = getToken();
    const second = getToken();
    release(token("t1"));

    expect(await first).toBe("t1");
    expect(await second).toBe("t1");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("כשל אינו ננעל: הקריאה הבאה מנסה שוב, וגם היא במקביל היא בקשה אחת", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue(token("t1"));
    const getToken = createAccessTokenProvider(CONFIG, { fetch: fetchSpy });

    // שני קוראים מקבלים את אותו כשל — לא שתי בקשות שנכשלות בנפרד.
    const [first, second] = await Promise.allSettled([getToken(), getToken()]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("rejected");
    expect(fetchSpy).toHaveBeenCalledOnce();

    // ומיד אחרי זה המסלול פתוח שוב.
    expect(await getToken()).toBe("t1");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("שגיאת HTTP נושאת את הסטטוס ואת גוף התשובה — שם יושב invalid_grant", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      response({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, {
        ok: false,
        status: 400,
      }),
    );
    const getToken = createAccessTokenProvider(CONFIG, { fetch: fetchSpy });

    await expect(getToken()).rejects.toThrow(/400/);
    await expect(getToken()).rejects.toThrow(/invalid_grant/);
  });

  it("השגיאה נושאת את קוד ה-HTTP, כדי שהקורא יבחין בין נשלל לעמוס", async () => {
    // הקוד הוא כל ההבדל בין שתי תקלות שההתנהגות הנכונה בהן הפוכה: 400
    // (`invalid_grant`) לא יצליח לעולם ודורש אדם, 503 יצליח בסבב הבא.
    // `email-intake/gmail-source.ts` מתרגם את הקוד ל-`MailErrorKind`.
    const rejected = createAccessTokenProvider(CONFIG, {
      fetch: vi.fn().mockResolvedValue(response({ error: "invalid_grant" }, { ok: false, status: 400 })),
    });
    const busy = createAccessTokenProvider(CONFIG, {
      fetch: vi.fn().mockResolvedValue(response("backend error", { ok: false, status: 503 })),
    });

    await expect(rejected()).rejects.toMatchObject({ name: "GoogleTokenError", status: 400 });
    await expect(busy()).rejects.toMatchObject({ status: 503 });
    // ונשאר `Error` לכל דבר: המסלול השולח אינו מסווג דבר ולא השתנה.
    await expect(rejected()).rejects.toBeInstanceOf(Error);
    await expect(rejected()).rejects.toBeInstanceOf(GoogleTokenError);
  });

  it("expires_in שאינו מספר אינו מבטל את המטמון בשקט", async () => {
    // `"abc" * 1000` הוא NaN, וכל השוואה מול NaN היא false — כלומר מטמון
    // שלעולם אינו תקף ובקשת טוקן על **כל** קריאה. אין שגיאה, אין לוג:
    // הערוץ עובד עד שגוגל מגבילה את הקצב.
    const time = clock();
    const fetchSpy = vi.fn().mockResolvedValue(response({ access_token: "t1", expires_in: "abc" }));
    const getToken = createAccessTokenProvider(CONFIG, { fetch: fetchSpy, now: time.now });

    await getToken();
    time.advance(1000);

    expect(await getToken()).toBe("t1");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("תשובה בלי access_token נחשבת כשל, ולא כטוקן ריק", async () => {
    // גוגל מחזירה 200 עם גוף שאינו כולל טוקן במצבים מסוימים; טוקן ריק
    // היה נשלח ככותרת `Bearer ` וחוזר כ-401 חסר פשר מהקצה השני.
    const fetchSpy = vi.fn().mockResolvedValue(response({ expires_in: 3600 }));

    await expect(createAccessTokenProvider(CONFIG, { fetch: fetchSpy })()).rejects.toThrow(
      /access_token/,
    );
  });

  it("גוף שאינו JSON נושא את הגוף עצמו בהודעה", async () => {
    // תשובה כזו מגיעה מ-proxy או מ-captive portal באמצע. בלי הגוף, ההודעה
    // הייתה `Unexpected token <` — שאינה אומרת דבר על מה שקרה.
    const fetchSpy = vi.fn().mockResolvedValue(response("<html>Service Unavailable</html>"));

    await expect(createAccessTokenProvider(CONFIG, { fetch: fetchSpy })()).rejects.toThrow(
      /Service Unavailable/,
    );
  });

  it("כל provider מחזיק מטמון משלו", async () => {
    // המטמון הוא ברמת המופע ולא גלובלי, כדי שבדיקה שבונה טרנספורט משלה לא
    // תירש טוקן של ריצה קודמת.
    const fetchSpy = vi.fn().mockResolvedValue(token("t1"));

    await createAccessTokenProvider(CONFIG, { fetch: fetchSpy })();
    await createAccessTokenProvider(CONFIG, { fetch: fetchSpy })();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("בלי הזרקה משתמש ב-fetch הגלובלי, ונקרא בזמן הבקשה ולא בזמן הבנייה", async () => {
    // סדר הפעולות הזה הוא מה שמאפשר לבדיקות של המסלולים שמעליו להחליף
    // `fetch` אחרי שהטרנספורט כבר נבנה.
    const getToken = createAccessTokenProvider(CONFIG);
    const fetchSpy = vi.fn().mockResolvedValue(token("global"));
    vi.stubGlobal("fetch", fetchSpy);

    expect(await getToken()).toBe("global");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
