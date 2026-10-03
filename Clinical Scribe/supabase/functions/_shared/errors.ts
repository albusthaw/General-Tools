// Problems with an AI service, sorted into kinds that decide whether to try again
// and what to tell the person.

export type ProviderErrorKind =
  | "auth" // the key was refused
  | "quota" // the account has no credit left
  | "rate" // too many requests right now
  | "model" // the chosen model is not available
  | "bad_request" // the service could not use what it was sent
  | "unavailable" // the service had a problem
  | "timeout" // no answer in time
  | "not_set_up" // no key saved
  | "retention" // the account may not use zero retention (ElevenLabs)
  | "invalid_output"; // the answer could not be used

export type ProviderName = "gemini" | "elevenlabs" | "deepseek";

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    public provider: ProviderName,
    detail: string,
    public status: number | null = null,
    public retryAfterSeconds: number | null = null,
  ) {
    super(detail);
  }

  get retryable(): boolean {
    return this.kind === "rate" || this.kind === "unavailable" || this.kind === "timeout" || this.kind === "invalid_output";
  }
}

const NAMES: Record<ProviderName, string> = { gemini: "Gemini", elevenlabs: "ElevenLabs", deepseek: "DeepSeek" };

export function providerLabel(provider: ProviderName): string {
  return NAMES[provider];
}

// What the person sees. No codes, no technical words.
export function userMessage(error: ProviderError): string {
  const name = NAMES[error.provider];
  switch (error.kind) {
    case "auth":
      return `${name} did not accept the saved service key. Ask an administrator to check it in AI settings.`;
    case "quota":
      return `The ${name} account has run out of credit. Ask an administrator to top it up, then try again.`;
    case "rate":
      return `${name} is busy right now. Please try again in a few minutes.`;
    case "model":
      return `The chosen ${name} model is not available. Ask an administrator to choose another model in AI settings.`;
    case "bad_request":
      return `${name} could not use this recording. If it keeps happening, try recording again.`;
    case "timeout":
      return `${name} took too long to answer. Please try again.`;
    case "not_set_up":
      return `${name} is not set up yet. Ask an administrator to add the service key in AI settings.`;
    case "invalid_output":
      return `${name} gave an answer that could not be used. Please try again.`;
    case "retention":
      return `This ${name} account cannot use zero retention; ${name} allows it only for Enterprise accounts. Ask an administrator to switch off "Ask ElevenLabs not to keep recordings" in AI settings, then use Try again.`;
    default:
      return `${name} had a problem. Please try again in a few minutes.`;
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, Math.min(3600, Math.round(seconds)));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(1, Math.min(3600, Math.round((date - Date.now()) / 1000)));
  return null;
}

// Turns an unsuccessful HTTP answer into a ProviderError.
export function classifyHttpError(provider: ProviderName, status: number, body: string, retryAfter: string | null): ProviderError {
  const lower = body.toLowerCase();
  const detail = `${provider} answered ${status}: ${body.slice(0, 400)}`;
  const retry = parseRetryAfter(retryAfter);
  const mentionsModel = /\bmodel/.test(lower) &&
    /(not found|not supported|does not exist|unknown|invalid|unavailable|not available|no access|permission)/.test(lower);

  if (status === 401) return new ProviderError("auth", provider, detail, status);
  if (status === 403) return new ProviderError(mentionsModel ? "model" : "auth", provider, detail, status);
  if (status === 402) return new ProviderError("quota", provider, detail, status);
  if (status === 429) {
    const outOfCredit = /(insufficient|balance|credit|quota exceeded|billing|exceeded your current quota)/.test(lower) &&
      !/rate|per minute|try again/.test(lower);
    return new ProviderError(outOfCredit ? "quota" : "rate", provider, detail, status, retry ?? 30);
  }
  if (status === 404) return new ProviderError(mentionsModel || /models\//.test(lower) ? "model" : "bad_request", provider, detail, status);
  if (status === 400 || status === 422) {
    if (mentionsModel) return new ProviderError("model", provider, detail, status);
    if (/(api key|api_key|apikey).*(invalid|not valid|expired)/.test(lower)) return new ProviderError("auth", provider, detail, status);
    if (/insufficient.*(balance|credit|quota)/.test(lower)) return new ProviderError("quota", provider, detail, status);
    return new ProviderError("bad_request", provider, detail, status);
  }
  if (status === 408 || status === 504) return new ProviderError("timeout", provider, detail, status, retry);
  if (status >= 500) return new ProviderError("unavailable", provider, detail, status, retry);
  return new ProviderError("bad_request", provider, detail, status);
}
