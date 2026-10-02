// The Supabase Management API (api.supabase.com), used with the access token for
// project details, API keys, sign-in settings and server function settings.
import { problemText, request } from "./http.mjs";
import { DeployError } from "./output.mjs";

export function managementApi(settings) {
  const headers = { Authorization: `Bearer ${settings.accessToken}`, Accept: "application/json" };
  const base = `${settings.apiBase}/v1/projects/${settings.ref}`;

  async function call(method, path, body, what) {
    const response = await request(`${base}${path}`, { method, headers, body, what: `Asking Supabase to ${what}` });
    if (response.status === 401) {
      throw new DeployError("Supabase did not accept the access token. Check SUPABASE_ACCESS_TOKEN, or create a new token.");
    }
    if (response.status === 403) {
      throw new DeployError("The access token is not allowed to change this project. Use a token from an account that can manage the project.");
    }
    if (response.status === 404) {
      throw new DeployError("No Supabase project was found with that code. Check SUPABASE_PROJECT_REF.");
    }
    if (!response.ok) {
      throw new DeployError(`Supabase could not ${what} (status ${response.status}). ${problemText(response)}`.trim());
    }
    return response.data;
  }

  return {
    project: () => call("GET", "", undefined, "read the project"),
    apiKeys: () => call("GET", "/api-keys?reveal=true", undefined, "read the project's API keys"),
    authConfig: () => call("GET", "/config/auth", undefined, "read the sign-in settings"),
    updateAuthConfig: (patch) => call("PATCH", "/config/auth", patch, "save the sign-in settings"),
    setSecrets: (list) => call("POST", "/secrets", list, "save the server function settings"),
  };
}

function usable(key) {
  const value = key?.api_key;
  return typeof value === "string" && value.length >= 20 && /^[A-Za-z0-9._-]+$/.test(value);
}

function find(list, type, names) {
  for (const name of names) {
    const match = list.find((key) => (key.type ?? "legacy") === type && (name === null || key.name === name) && usable(key));
    if (match) return match.api_key;
  }
  return null;
}

// The newer publishable and secret keys when the project has them, otherwise the
// older anon and service_role keys.
export function pickKeys(list) {
  const keys = Array.isArray(list) ? list : [];
  return {
    publishable: find(keys, "publishable", ["default", null]) ?? find(keys, "legacy", ["anon"]),
    secret: find(keys, "secret", ["default", null]) ?? find(keys, "legacy", ["service_role"]),
  };
}
