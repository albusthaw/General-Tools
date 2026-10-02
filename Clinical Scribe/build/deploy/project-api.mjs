// The project's own API (https://<code>.supabase.co), used with the secret key to
// record the deploy in the database and to create the first admin.
import { problemText, request, sleep } from "./http.mjs";
import { DeployError } from "./output.mjs";

// Newer keys go only in the apikey header; older JWT keys also as a bearer token.
export function keyHeaders(key) {
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

export function projectApi(settings, secretKey, { waitMs = 90_000 } = {}) {
  const headers = { ...keyHeaders(secretKey), Accept: "application/json" };

  // Calls a database function. Straight after new migrations the API can take a
  // few seconds to see new functions, so "not found yet" is tried again for a while.
  async function rpc(name, args, what) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const response = await request(`${settings.projectUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers,
        body: args,
        what: `Trying to ${what}`,
      });
      if (response.ok) return response.data;
      const code = response.data?.code;
      const notReady = code === "PGRST202" || code === "PGRST002" || response.status === 503;
      if (notReady && Date.now() < deadline) {
        await sleep(5_000);
        continue;
      }
      throw new DeployError(`The server could not ${what} (status ${response.status}). ${problemText(response)}`.trim());
    }
  }

  // One try only; null when the database does not have the function (yet).
  async function optionalRpc(name, args = {}) {
    const response = await request(`${settings.projectUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers,
      body: args,
      what: `Asking the database for ${name}`,
    });
    if (response.ok) return response.data;
    if (response.data?.code === "PGRST202" || response.status === 404) return null;
    throw new DeployError(`The server could not answer ${name} (status ${response.status}). ${problemText(response)}`.trim());
  }

  async function hasAccounts() {
    const response = await request(`${settings.projectUrl}/auth/v1/admin/users?page=1&per_page=1`, {
      headers,
      what: "Listing accounts",
    });
    if (!response.ok) {
      throw new DeployError(`The sign-in service could not list accounts (status ${response.status}). ${problemText(response)}`.trim());
    }
    return Array.isArray(response.data?.users) && response.data.users.length > 0;
  }

  // Returns "created", or "exists" when the email address already has an account.
  async function createAccount({ email, password, name }) {
    const response = await request(`${settings.projectUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: { email, password, email_confirm: true, user_metadata: { full_name: name } },
      what: "Creating the first admin",
    });
    if (response.ok) return "created";
    const code = String(response.data?.error_code ?? response.data?.code ?? "");
    if (code === "email_exists" || code === "user_already_exists") return "exists";
    if (code === "weak_password") {
      throw new DeployError("The sign-in service refused the admin password as too weak. Use at least 10 characters with letters and numbers.");
    }
    throw new DeployError(`The first admin could not be created (status ${response.status}). ${problemText(response)}`.trim());
  }

  return { rpc, optionalRpc, hasAccounts, createAccount };
}
