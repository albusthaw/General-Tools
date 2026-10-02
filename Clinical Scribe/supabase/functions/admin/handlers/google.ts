// Google sign-in. Settings are applied to the project's Supabase Auth through the
// Supabase Management API, using an access token the admin saves here.
import { projectRef, serviceBase } from "../../_shared/env.ts";
import { AppError } from "../../_shared/http.ts";
import { forgetSecret, getSecret, rememberSecret } from "../../_shared/secrets.ts";
import { adminClient, rpc } from "../../_shared/supabase.ts";
import * as v from "../../_shared/validate.ts";
import type { AdminContext } from "../context.ts";

const CLIENT_ID = /^[0-9A-Za-z._-]{6,180}\.apps\.googleusercontent\.com$/;

async function currentSettings() {
  const { data, error } = await adminClient()
    .from("app_settings")
    .select("google_enabled, google_client_id")
    .eq("id", true)
    .single();
  if (error || !data) throw new Error("Settings could not be read.");
  return data as { google_enabled: boolean; google_client_id: string };
}

async function tokenStatus(): Promise<{ saved: boolean; last4: string }> {
  const rows = await rpc<Array<{ name: string; last4: string }>>("svc_secret_status");
  const row = (rows ?? []).find((item) => item.name === "management_token");
  return { saved: Boolean(row), last4: row?.last4 ?? "" };
}

async function management(token: string, method: "GET" | "PATCH", body?: unknown) {
  const ref = projectRef();
  if (!ref) {
    throw new AppError("no_project_ref", "The project could not be identified. Run the deploy again so it can record the project.", 409);
  }
  let response: Response;
  try {
    response = await fetch(`${serviceBase("supabase_api")}/v1/projects/${ref}/config/auth`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AppError("supabase_unreachable", "Supabase could not be reached. Please try again.", 502);
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError("token_refused", "Supabase did not accept the access token. Check that it is correct and allowed to change sign-in settings.", 400);
  }
  if (response.status === 404) {
    throw new AppError("project_not_found", "This project could not be found with that access token.", 400);
  }
  if (!response.ok) {
    throw new AppError("supabase_error", "Supabase could not save the sign-in settings. Please try again.", 502);
  }
  return await response.json() as Record<string, unknown>;
}

// The app's own address, checked against the browser that sent the request.
function appAddress(req: Request, value: unknown): string {
  const raw = v.text(value, { label: "App address", min: 8, max: 300 });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("invalid_input", "The app address is not valid.", 400);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new AppError("invalid_input", "The app must be opened over https for Google sign-in.", 400);
  }
  const origin = (req.headers.get("origin") ?? "").replace(/\/+$/, "");
  if (origin && origin !== url.origin) throw new AppError("invalid_input", "The app address does not match this page.", 400);
  return `${url.origin}${url.pathname}`;
}

export async function get(_: AdminContext) {
  const settings = await currentSettings();
  return {
    enabled: settings.google_enabled,
    client_id: settings.google_client_id,
    token: await tokenStatus(),
  };
}

export async function save({ caller, body, req }: AdminContext) {
  const enabled = v.bool(body.enabled);
  const clientId = v.text(body.client_id, { label: "Client ID", max: 200 });
  const clientSecret = v.text(body.client_secret, { label: "Client secret", max: 300 });
  const app = appAddress(req, body.app_url);
  const settings = await currentSettings();

  if (enabled || clientId) {
    if (!CLIENT_ID.test(clientId)) {
      throw new AppError("invalid_input", "The Client ID should end with .apps.googleusercontent.com.", 400);
    }
  }
  const clientChanged = clientId !== settings.google_client_id;
  if (enabled && clientChanged && !clientSecret) {
    throw new AppError("secret_needed", "Enter the client secret for this Client ID.", 400);
  }

  const token = await getSecret("management_token");
  if (!token) throw new AppError("token_needed", "Save your Supabase access token first.", 409);
  if (clientSecret) rememberSecret(clientSecret);

  const current = await management(token, "GET");
  const allowList = String(current.uri_allow_list ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!allowList.includes(app)) allowList.push(app);

  const patch: Record<string, unknown> = {
    external_google_enabled: enabled,
    uri_allow_list: allowList.join(","),
  };
  if (clientId) patch.external_google_client_id = clientId;
  if (clientSecret) patch.external_google_secret = clientSecret;
  const site = String(current.site_url ?? "");
  if (!site || /localhost|127\.0\.0\.1/.test(site)) patch.site_url = app;

  await management(token, "PATCH", patch);
  await rpc("svc_set_google", { p_enabled: enabled, p_client_id: clientId, p_actor: caller.id, p_user_agent: caller.userAgent });
  return await get({ caller, body, req });
}

export async function saveToken({ caller, body }: AdminContext) {
  const value = v.serviceKey(body.value);
  rememberSecret(value);
  // Check the token can read this project's sign-in settings before keeping it.
  await management(value, "GET");
  await rpc("svc_set_secret", { p_name: "management_token", p_value: value, p_actor: caller.id, p_user_agent: caller.userAgent });
  forgetSecret("management_token");
  return { token: await tokenStatus() };
}

export async function removeToken({ caller }: AdminContext) {
  await rpc("svc_delete_secret", { p_name: "management_token", p_actor: caller.id, p_user_agent: caller.userAgent });
  forgetSecret("management_token");
  return { token: await tokenStatus() };
}
