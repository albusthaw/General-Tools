// Turns any error into a short message a person can act on.

export class UserError extends Error {
  constructor(message, code = "error") {
    super(message);
    this.code = code;
  }
}

const GENERIC = "Something went wrong. Please try again.";
const OFFLINE = "The server cannot be reached. Check your internet connection and try again.";

// Database functions send a plain-language message with a "cs:<code>" hint.
export function fromDatabase(error) {
  if (!error) return null;
  const hint = typeof error.hint === "string" ? error.hint : "";
  if (hint.startsWith("cs:")) return new UserError(error.message || GENERIC, hint.slice(3));
  if (isNetwork(error)) return new UserError(OFFLINE, "offline");
  if (error.code === "PGRST301" || /jwt/i.test(error.message ?? "")) {
    return new UserError("Your session has ended. Please sign in again.", "not_signed_in");
  }
  return new UserError(GENERIC, error.code ?? "error");
}

// Edge Functions answer { error: { code, message } } with plain words.
export async function fromFunction(error) {
  if (!error) return null;
  let payload = null;
  try {
    payload = await error.context?.json?.();
  } catch {
    payload = null;
  }
  if (payload?.error?.message) return new UserError(payload.error.message, payload.error.code ?? "error");
  if (isNetwork(error) || error.name === "FunctionsFetchError") return new UserError(OFFLINE, "offline");
  return new UserError(GENERIC, "error");
}

function isNetwork(error) {
  const text = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /fetch|network|load failed|failed to fetch/i.test(text) && !/jwt/i.test(text);
}

export function messageOf(error) {
  if (!error) return GENERIC;
  if (error instanceof UserError) return error.message;
  if (isNetwork(error)) return OFFLINE;
  return GENERIC;
}
