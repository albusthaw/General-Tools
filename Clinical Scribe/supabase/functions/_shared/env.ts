// Reads the settings Supabase gives every function, plus a few optional ones.

export function supabaseUrl(): string {
  const value = Deno.env.get("SUPABASE_URL");
  if (!value) throw new Error("SUPABASE_URL is not available to the function.");
  return value.replace(/\/+$/, "");
}

// The server key. New projects provide named secret keys as JSON; older projects
// provide the service_role key.
export function serverKey(): string {
  const named = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (named) {
    try {
      const parsed = JSON.parse(named) as Record<string, unknown>;
      const value = parsed["default"] ?? Object.values(parsed)[0];
      if (typeof value === "string" && value.length > 0) return value;
    } catch {
      // Fall through to the older key.
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new Error("No server key is available to the function.");
}

// Origins allowed to call the functions from a browser. Empty means any origin;
// every call still needs a valid sign-in, so this only narrows who can try.
export function allowedOrigins(): string[] {
  return (Deno.env.get("CS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

// How long the worker may keep claiming work in one run, in seconds. The free plan
// stops a function after 150 seconds; paid plans allow 400.
export function workerBudgetSeconds(): number {
  const value = Number(Deno.env.get("CS_WORKER_BUDGET_SECONDS") ?? "120");
  return Number.isFinite(value) ? Math.min(380, Math.max(100, value)) : 120;
}

// Service addresses. They can be pointed at stand-in services for automated tests.
export function serviceBase(name: "gemini" | "elevenlabs" | "deepseek" | "supabase_api"): string {
  const defaults = {
    gemini: "https://generativelanguage.googleapis.com",
    elevenlabs: "https://api.elevenlabs.io",
    deepseek: "https://api.deepseek.com",
    supabase_api: "https://api.supabase.com",
  } as const;
  const overrides = {
    gemini: "CS_TEST_GEMINI_BASE_URL",
    elevenlabs: "CS_TEST_ELEVENLABS_BASE_URL",
    deepseek: "CS_TEST_DEEPSEEK_BASE_URL",
    supabase_api: "CS_TEST_SUPABASE_API_BASE_URL",
  } as const;
  const override = Deno.env.get(overrides[name]);
  return (override && override.length > 0 ? override : defaults[name]).replace(/\/+$/, "");
}

// The Supabase project reference, for the Management API (Google sign-in).
export function projectRef(): string | null {
  const explicit = Deno.env.get("CS_PROJECT_REF");
  if (explicit && /^[a-z0-9]{20}$/.test(explicit)) return explicit;
  try {
    const host = new URL(supabaseUrl()).hostname;
    const match = host.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
