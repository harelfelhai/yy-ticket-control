import { WaApiError, classifyGraphError, parseGraphError } from "./errors";

/**
 * הבקשות ל-Graph API — המקום היחיד שפונה לרשת בשם וואטסאפ.
 *
 * כל כשל הופך כאן ל-`WaApiError` מסווג, כך שהקורא לעולם אינו מנחש מתוך
 * `fetch` גולמי. הטוקן אינו נכנס להודעת השגיאה ולא ללוג: הוא נשלח רק בכותרת.
 */

const GRAPH_HOST = "https://graph.facebook.com";

/** גג זמן לבקשה אחת. בלעדיו קריאה שנתקעת מחזיקה את הג׳וב עד גג הזמן שלו. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface GraphConfig {
  /** טוקן העסק — בפענוח, ממש לפני הבקשה */
  token: string;
  /** גרסת ה-API, למשל `v25.0` (`WHATSAPP_GRAPH_VERSION`) */
  version: string;
  /** מוזרק בבדיקות. ברירת המחדל — `fetch` של הסביבה. */
  fetch?: typeof fetch;
}

/** הכתובת של נתיב ב-Graph, בגרסה שנקבעה */
export function graphUrl(config: Pick<GraphConfig, "version">, path: string): string {
  return `${GRAPH_HOST}/${config.version}/${path.replace(/^\/+/, "")}`;
}

/**
 * בקשה עם הטוקן, והחזרת התשובה כמו שהיא — או `WaApiError` כשהיא נכשלה.
 * משמשת גם להורדת הבתים של מדיה, שאינם JSON.
 */
export async function graphFetch(
  config: GraphConfig,
  url: string,
  init: { method?: "GET" | "POST"; json?: unknown } = {},
): Promise<Response> {
  const doFetch = config.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(init.json === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WaApiError(`הבקשה ל-Graph לא הגיעה לתשובה: ${errorText(error)}`, "transient", { cause: error });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const body = parseGraphError(text);
    const kind = classifyGraphError(response.status, body);
    const detail = body.message ? ` — ${body.message.slice(0, 300)}` : "";
    throw new WaApiError(`Graph החזיר ${response.status}${body.code === undefined ? "" : ` (${body.code})`}${detail}`, kind, {
      status: response.status,
      code: body.code,
    });
  }
  return response;
}

/** בקשה ל-Graph שהתשובה עליה היא JSON */
export async function graphJson<T>(
  config: GraphConfig,
  path: string,
  init: { method?: "GET" | "POST"; json?: unknown } = {},
): Promise<T> {
  const response = await graphFetch(config, graphUrl(config, path), init);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new WaApiError("תשובת Graph אינה JSON", "permanent", { status: response.status, cause: error });
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
