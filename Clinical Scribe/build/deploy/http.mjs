// fetch with a time limit, and a few tries when a service is busy or briefly away.
import { DeployError, scrub } from "./output.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one request and returns { status, ok, data, text }. Busy answers (429 and
 * 5xx) and lost connections are tried again; the last answer is returned as is.
 */
export async function request(url, { method = "GET", headers = {}, body, timeoutMs = 30_000, attempts = 4, what = "The request" } = {}) {
  let problem = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        await sleep(2_000 * attempt);
        continue;
      }
      return { status: response.status, ok: response.ok, data, text };
    } catch (error) {
      problem = error?.name === "TimeoutError" ? "there was no answer in time" : "the service could not be reached";
      if (attempt < attempts) await sleep(2_000 * attempt);
    }
  }
  throw new DeployError(`${what} did not work: ${problem}.`);
}

// The service's own explanation, with anything key-like removed.
export function problemText(response) {
  const data = response.data;
  let message = response.text;
  if (data && typeof data === "object") {
    message = data.message ?? data.msg ?? data.error_description ?? data.error ?? response.text;
  }
  return scrub(typeof message === "string" ? message : JSON.stringify(message));
}
