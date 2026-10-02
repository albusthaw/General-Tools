// HTTP calls to the AI services with a time limit and consistent error handling.
import { classifyHttpError, ProviderError, type ProviderName } from "../errors.ts";

export async function send(
  provider: ProviderName,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw classifyHttpError(provider, response.status, body, response.headers.get("retry-after"));
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) {
      throw new ProviderError("timeout", provider, `${provider} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw new ProviderError("unavailable", provider, `${provider} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendJson<T>(
  provider: ProviderName,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const response = await send(provider, url, init, timeoutMs);
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError("invalid_output", provider, `${provider} sent an answer that was not JSON.`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
