// Fresh data for the browser tests: an admin with service keys, and one user.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { invoke, mock, serverClient, signIn, sql, toolRoot } from "../helpers/local.mjs";

export const ADMIN = { email: "admin@clinic.test", password: "Admin-pass-2026", name: "Dr Amelia Hart" };
export const USER = { email: "sam@clinic.test", password: "Sam-pass-2026x", name: "Dr Sam Patel" };

export async function seed() {
  execFileSync("supabase", ["db", "reset", "--local"], { cwd: toolRoot, stdio: "ignore" });
  await mock("/__reset", {});
  // Short audio parts so the tests can see recordings split into several parts.
  sql("insert into app_private.runtime_config (key, value) values ('segment_seconds', '5') on conflict (key) do update set value = excluded.value");

  const server = serverClient();
  const { data, error } = await server.auth.admin.createUser({
    email: ADMIN.email,
    password: ADMIN.password,
    email_confirm: true,
    user_metadata: { full_name: ADMIN.name },
  });
  if (error) throw error;
  sql(`update public.profiles set full_name = '${ADMIN.name}' where id = '${data.user.id}'`);

  const admin = await signIn(ADMIN.email, ADMIN.password);
  for (const [name, value] of [
    ["elevenlabs_api_key", "test-elevenlabs-key-0001"],
    ["gemini_api_key", "test-gemini-key-0001"],
    ["deepseek_api_key", "test-deepseek-key-0001"],
  ]) {
    const saved = await invoke(admin, "admin", { action: "keys.save", name, value });
    if (saved.error) throw new Error(`Could not save ${name}: ${saved.error.message}`);
  }
  await admin.rpc("admin_set_unlimited", { p_user: data.user.id, p_unlimited: true });
  const created = await invoke(admin, "admin", {
    action: "users.create",
    email: USER.email,
    full_name: USER.name,
    password: USER.password,
    role: "user",
    elevenlabs_minutes: 120,
    gemini_minutes: 60,
    unlimited: false,
  });
  if (created.error) throw new Error(`Could not create the user: ${created.error.message}`);
  // A deploy records the app version on the server; the app warns when they differ.
  const version = readFileSync(join(toolRoot, "VERSION"), "utf8").trim();
  sql(`select public.svc_set_server_version('${version}')`);
}
