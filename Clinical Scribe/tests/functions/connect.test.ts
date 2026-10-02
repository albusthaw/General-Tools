// Unit tests for the connect function's answer builder: only public values ever
// leave the server, and a secret key is never taken for a public one.
// Run from the Clinical Scribe folder: deno test tests/functions/
import { assert, assertEquals } from "jsr:@std/assert@1";
import { cleanOrigin, cleanSite, connectAnswer, isPublicKey, publicKeyFrom } from "../../supabase/functions/_shared/connect.ts";

const PUBLISHABLE = "sb_publishable_abcdefghijklmnopqrstuvwx";
const token = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.c2lnbmF0dXJl`;
const envOf = (values: Record<string, string>) => (name: string) => values[name];

Deno.test("only public keys count as public", () => {
  assert(isPublicKey(PUBLISHABLE));
  assert(isPublicKey(token("anon")));
  assert(!isPublicKey("sb_secret_abcdefghijklmnopqrstuvwx"));
  assert(!isPublicKey(token("service_role")));
  assert(!isPublicKey(token("supabase_admin")));
  assert(!isPublicKey(""));
  assert(!isPublicKey(undefined));
  assert(!isPublicKey(`sb_publishable_${"x".repeat(3000)}`));
});

Deno.test("the public key comes from the deploy's setting, else from the keys Supabase gives", () => {
  assertEquals(publicKeyFrom(envOf({ CS_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_ANON_KEY: token("anon") })), PUBLISHABLE);
  assertEquals(publicKeyFrom(envOf({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }) })), PUBLISHABLE);
  assertEquals(publicKeyFrom(envOf({ SUPABASE_PUBLISHABLE_KEYS: "{broken", SUPABASE_ANON_KEY: token("anon") })), token("anon"));
  // A secret key put in the wrong setting by mistake is never handed out.
  assertEquals(publicKeyFrom(envOf({ CS_PUBLISHABLE_KEY: "sb_secret_abcdefghijklmnopqrstuvwx" })), null);
  assertEquals(publicKeyFrom(envOf({ SUPABASE_ANON_KEY: token("service_role") })), null);
  assertEquals(publicKeyFrom(envOf({})), null);
});

Deno.test("addresses are https only (http only on this computer)", () => {
  assertEquals(cleanOrigin("https://abc.supabase.co/rest/v1"), "https://abc.supabase.co");
  assertEquals(cleanOrigin("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assertEquals(cleanOrigin("http://abc.supabase.co"), null);
  assertEquals(cleanOrigin("not an address"), null);
  assertEquals(cleanSite("https://name.github.io/General-Tools"), "https://name.github.io/General-Tools/");
  assertEquals(cleanSite("https://user:pass@name.github.io/"), null);
  assertEquals(cleanSite("javascript:alert(1)"), null);
  assertEquals(cleanSite(undefined), null);
});

Deno.test("the answer holds the public details and nothing else", () => {
  const answer = connectAnswer({ serverUrl: "https://abc.supabase.co", key: PUBLISHABLE, name: "x".repeat(100), version: "1.2.0", siteUrl: "https://name.github.io/General-Tools/" });
  assertEquals(Object.keys(answer).sort(), ["app", "app_url", "name", "publishable_key", "server_url", "site_url", "version"]);
  assertEquals(answer.app, "clinical-scribe");
  assertEquals(answer.name.length, 80);
  assertEquals(answer.app_url, "https://name.github.io/General-Tools/app/");
  const bare = connectAnswer({ serverUrl: "https://abc.supabase.co", key: PUBLISHABLE, name: "", version: "1.2.0", siteUrl: null });
  assertEquals(Object.keys(bare).sort(), ["app", "name", "publishable_key", "server_url", "version"]);
});
