// Public connection details for the Clinical Scribe apps (the Android app and the
// iPhone web app). Answers GET with public values only and changes nothing, so it
// needs no sign-in and may be read from any address.
import { cleanOrigin, cleanSite, connectAnswer, publicKeyFrom } from "../_shared/connect.ts";
import { supabaseUrl } from "../_shared/env.ts";
import { adminClient } from "../_shared/supabase.ts";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function reply(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "Cache-Control": cache } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "GET") return reply({ error: { code: "method", message: "This address only answers GET." } }, 405);

  const env = (name: string) => Deno.env.get(name);
  const key = publicKeyFrom(env);
  // The address the apps use: the project's own, or a public address set for local testing.
  const serverUrl = cleanOrigin(env("CS_PUBLIC_URL")) ?? cleanOrigin(supabaseUrl());
  if (!key || !serverUrl) {
    return reply({ error: { code: "not_ready", message: "This server is not ready for the apps yet. Run the deploy again." } }, 503);
  }

  const { data, error } = await adminClient().rpc("get_public_config");
  if (error || !data) {
    return reply({ error: { code: "server", message: "The server could not answer. Please try again." } }, 503);
  }
  const answer = connectAnswer({
    serverUrl,
    key,
    name: typeof data.clinic_name === "string" ? data.clinic_name : "",
    version: typeof data.server_version === "string" ? data.server_version : "0.0.0",
    siteUrl: cleanSite(env("CS_SITE_URL")),
  });
  return reply(answer, 200, "public, max-age=300");
});
