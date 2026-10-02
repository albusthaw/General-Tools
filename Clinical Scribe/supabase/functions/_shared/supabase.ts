// The server-side Supabase client. It uses the server key and bypasses Row Level
// Security, so it is only used after the caller has been checked.
import { createClient, type SupabaseClient } from "./deps.ts";
import { serverKey, supabaseUrl } from "./env.ts";

let client: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl(), serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "clinical-scribe-functions" } },
    });
  }
  return client;
}

// Calls a database function and throws on error.
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await adminClient().rpc(name, args);
  if (error) throw databaseError(error);
  return data as T;
}

interface PostgrestLikeError {
  message?: string;
  hint?: string | null;
  code?: string;
  details?: string | null;
}

// Database functions raise friendly errors with a "cs:<code>" hint. Those are
// safe to show; anything else is a server problem.
export class DatabaseError extends Error {
  constructor(
    public code: string,
    message: string,
    public friendly: boolean,
  ) {
    super(message);
  }
}

export function databaseError(error: PostgrestLikeError): DatabaseError {
  const hint = error.hint ?? "";
  if (hint.startsWith("cs:")) {
    return new DatabaseError(hint.slice(3), error.message ?? "That could not be done.", true);
  }
  return new DatabaseError(error.code ?? "database_error", error.message ?? "Database error.", false);
}
