// Request and response helpers shared by the browser-facing functions.
import { allowedOrigins } from "./env.ts";
import { scrub } from "./secrets.ts";
import { DatabaseError } from "./supabase.ts";

// An error that is safe to show to the person. `message` is plain language.
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get("origin") ?? "").replace(/\/+$/, "");
  const allowed = allowedOrigins();
  const allowOrigin = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// A handler answers with a file by returning one of these instead of data.
export class FileReply {
  constructor(
    public body: Blob,
    public filename: string,
  ) {}
}

function file(req: Request, reply: FileReply): Response {
  return new Response(reply.body, {
    status: 200,
    headers: {
      ...corsHeaders(req),
      // Read by the app as plain bytes; never shown by the browser as a page.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${reply.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Reads a JSON object body, refusing anything large or malformed.
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("too_large", "That request is too large.", 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new AppError("too_large", "That request is too large.", 413);
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("bad_request", "The request could not be read.", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("bad_request", "The request could not be read.", 400);
  }
  return parsed as Record<string, unknown>;
}

// Wraps a POST handler with CORS, error handling and safe logging.
export function serve(handler: (req: Request) => Promise<unknown>): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { error: { code: "not_found", message: "Not found." } }, 404);
    try {
      const data = await handler(req);
      if (data instanceof FileReply) return file(req, data);
      return json(req, { ok: true, data: data ?? null });
    } catch (error) {
      if (error instanceof AppError) {
        return json(req, { error: { code: error.code, message: error.message } }, error.status);
      }
      // Database functions raise plain-language errors that are safe to pass on.
      if (error instanceof DatabaseError && error.friendly) {
        return json(req, { error: { code: error.code, message: error.message } }, 409);
      }
      console.error("Unexpected error:", scrub(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)));
      return json(req, {
        error: { code: "server_error", message: "Something went wrong on the server. Please try again." },
      }, 500);
    }
  });
}
