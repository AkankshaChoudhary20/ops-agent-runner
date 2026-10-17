export interface HttpRequestInput {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

export interface HttpRequestResult {
  ok: boolean;
  status: number | null;
  statusText: string | null;
  body: string;
  error?: string;
}

const MAX_RESPONSE_BODY_CHARS = 8000;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Makes a GET or POST HTTP request to a public URL and returns the status
 * code and a truncated response body. This is the only outbound-network tool
 * exposed to the agent — it does not allow arbitrary shell execution or file
 * access, only a bounded HTTP call with a timeout.
 */
export async function httpRequest(
  input: HttpRequestInput
): Promise<HttpRequestResult> {
  const method = (input.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return {
      ok: false,
      status: null,
      statusText: null,
      body: "",
      error: `Unsupported method "${input.method}". Only GET and POST are allowed.`,
    };
  }

  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return {
      ok: false,
      status: null,
      statusText: null,
      body: "",
      error: `"${input.url}" is not a valid URL.`,
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      status: null,
      statusText: null,
      body: "",
      error: `Only http:// and https:// URLs are allowed (got "${url.protocol}").`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      body: method === "POST" ? input.body ?? "" : undefined,
      headers: {
        "content-type": "application/json",
        ...(input.headers ?? {}),
      },
      signal: controller.signal,
    });

    // Decode incrementally and stop reading once the returned text is full.
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    if (reader) {
      try {
        while (text.length <= MAX_RESPONSE_BODY_CHARS) {
          const { done, value } = await reader.read();
          if (done) { text += decoder.decode(); break; }
          text += decoder.decode(value, { stream: true });
        }
        if (text.length > MAX_RESPONSE_BODY_CHARS) await reader.cancel();
      } finally { reader.releaseLock(); }
    }
    const truncated = text.length > MAX_RESPONSE_BODY_CHARS
      ? text.slice(0, MAX_RESPONSE_BODY_CHARS) + "\n...[truncated]"
      : text;

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: truncated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: null,
      statusText: null,
      body: "",
      error: `Request failed: ${message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

