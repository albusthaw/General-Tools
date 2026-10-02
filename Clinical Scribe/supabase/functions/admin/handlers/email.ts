// Email (SMTP) settings. They are saved securely but not used by anything yet.
import { AppError } from "../../_shared/http.ts";
import { forgetSecret, rememberSecret } from "../../_shared/secrets.ts";
import { adminClient, rpc } from "../../_shared/supabase.ts";
import * as v from "../../_shared/validate.ts";
import type { AdminContext } from "../context.ts";

const HOST = /^(?=.{1,200}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export async function get(_: AdminContext) {
  const { data, error } = await adminClient()
    .from("app_settings")
    .select("smtp_host, smtp_port, smtp_security, smtp_username, smtp_sender_name, smtp_sender_email, smtp_updated_at")
    .eq("id", true)
    .single();
  if (error || !data) throw new Error("Settings could not be read.");
  const rows = await rpc<Array<{ name: string }>>("svc_secret_status");
  return { ...data, password_saved: (rows ?? []).some((row) => row.name === "smtp_password") };
}

export async function save(ctx: AdminContext) {
  const { caller, body } = ctx;
  const host = v.text(body.host, { label: "Server", max: 200 });
  if (host && !HOST.test(host)) throw new AppError("invalid_input", "The server name does not look right.", 400);
  const port = v.number(body.port, { label: "Port", min: 1, max: 65535, integer: true });
  const security = v.oneOf(body.security, ["ssl", "starttls", "none"] as const, "security");
  const username = v.text(body.username, { label: "User name", max: 200 });
  const senderName = v.text(body.sender_name, { label: "Sender name", max: 120 });
  const senderEmail = body.sender_email ? v.email(body.sender_email, "Sender email address") : "";
  const password = typeof body.password === "string" && body.password.length > 0
    ? v.text(body.password, { label: "Password", min: 1, max: 500, trim: false })
    : "";

  if (password) {
    rememberSecret(password);
    await rpc("svc_set_secret", { p_name: "smtp_password", p_value: password, p_actor: caller.id, p_user_agent: caller.userAgent });
    forgetSecret("smtp_password");
  } else if (body.remove_password === true) {
    await rpc("svc_delete_secret", { p_name: "smtp_password", p_actor: caller.id, p_user_agent: caller.userAgent });
    forgetSecret("smtp_password");
  }

  await rpc("svc_save_smtp", {
    p_host: host,
    p_port: port,
    p_security: security,
    p_username: username,
    p_sender_name: senderName,
    p_sender_email: senderEmail,
    p_actor: caller.id,
    p_user_agent: caller.userAgent,
  });
  return await get(ctx);
}
