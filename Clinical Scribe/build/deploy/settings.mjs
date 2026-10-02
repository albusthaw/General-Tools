// Reads and checks the values the deploy needs. They come from environment
// variables: repository secrets on GitHub, or values set in the terminal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeployError } from "./output.mjs";

const REF = /^[a-z]{20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export const TOOL_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function text(env, name) {
  const raw = env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

// Accepts the reference itself, the project address or a dashboard link.
export function parseProjectRef(raw) {
  const value = String(raw ?? "").trim();
  if (REF.test(value)) return value;
  const match =
    value.match(/^https:\/\/([a-z]{20})\.supabase\.co\/?$/) ??
    value.match(/^https:\/\/supabase\.com\/dashboard\/project\/([a-z]{20})(?:[/?#].*)?$/);
  return match ? match[1] : null;
}

// The address people open the app at. Always ends with "/", with no query or hash.
export function parseAppUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (url.username || url.password) return null;
  let path = url.pathname.replace(/index\.html$/, "");
  if (!path.endsWith("/")) path += "/";
  return { url: `${url.origin}${path}`, origin: url.origin };
}

// Matches the password rule the deploy sets on the project.
export function goodPassword(value) {
  return value.length >= 10 && value.length <= 72 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export function readVersion(root = TOOL_ROOT) {
  const version = readFileSync(join(root, "VERSION"), "utf8").trim();
  if (!VERSION.test(version)) throw new DeployError(`The VERSION file should hold a version such as 1.2.0, not "${version}".`);
  return version;
}

/**
 * Returns the checked settings, or throws one DeployError that lists every problem.
 * plan.server: the database and functions will be changed; plan.web: the web app is built.
 */
export function readSettings(env, plan, root = TOOL_ROOT) {
  const problems = [];

  const accessToken = text(env, "SUPABASE_ACCESS_TOKEN");
  if (!accessToken) problems.push("SUPABASE_ACCESS_TOKEN is missing. Create one at https://supabase.com/dashboard/account/tokens.");
  else if (/\s/.test(accessToken)) problems.push("SUPABASE_ACCESS_TOKEN contains spaces. Copy it again.");

  const refInput = text(env, "SUPABASE_PROJECT_REF");
  const ref = refInput ? parseProjectRef(refInput) : null;
  if (!refInput) problems.push("SUPABASE_PROJECT_REF is missing. It is the 20-letter code in the project address, https://<code>.supabase.co.");
  else if (!ref) problems.push("SUPABASE_PROJECT_REF should be the 20-letter project code (small letters only), as in https://<code>.supabase.co.");

  // Passwords are used exactly as given.
  const dbPassword = typeof env.SUPABASE_DB_PASSWORD === "string" ? env.SUPABASE_DB_PASSWORD : "";
  if (plan.server && !dbPassword) {
    problems.push("SUPABASE_DB_PASSWORD is missing. It is the database password chosen when the project was created (it can be reset under Project Settings → Database).");
  }

  const appInput = text(env, "APP_URL");
  const app = appInput ? parseAppUrl(appInput) : null;
  if (appInput && !app) problems.push("APP_URL should be the full https address of the app, for example https://name.github.io/General-Tools/.");

  let admin = null;
  const adminEmail = text(env, "CLINICAL_SCRIBE_ADMIN_EMAIL").toLowerCase();
  const adminPassword = typeof env.CLINICAL_SCRIBE_ADMIN_PASSWORD === "string" ? env.CLINICAL_SCRIBE_ADMIN_PASSWORD : "";
  const adminName = text(env, "CLINICAL_SCRIBE_ADMIN_NAME") || "Administrator";
  if (plan.server && (adminEmail || adminPassword)) {
    if (!EMAIL.test(adminEmail) || adminEmail.length > 254) problems.push("CLINICAL_SCRIBE_ADMIN_EMAIL should be a valid email address.");
    if (!goodPassword(adminPassword)) problems.push("CLINICAL_SCRIBE_ADMIN_PASSWORD should be 10 to 72 characters long, with letters and numbers.");
    if (adminName.length > 120) problems.push("CLINICAL_SCRIBE_ADMIN_NAME should be 120 characters or fewer.");
    admin = { email: adminEmail, password: adminPassword, name: adminName };
  }

  let version = "";
  try {
    version = readVersion(root);
  } catch (error) {
    problems.push(error instanceof DeployError ? error.message : "The VERSION file could not be read.");
  }

  if (problems.length > 0) {
    throw new DeployError(`Some values need attention:\n - ${problems.join("\n - ")}`);
  }

  // The CS_TEST_ values point the deploy at stand-in services for automated tests.
  const projectUrl = (text(env, "CS_TEST_DEPLOY_PROJECT_URL") || `https://${ref}.supabase.co`).replace(/\/+$/, "");
  return {
    root,
    accessToken,
    ref,
    dbPassword,
    app,
    admin,
    version,
    projectUrl,
    functionsUrl: (text(env, "CS_TEST_DEPLOY_FUNCTIONS_URL") || `${projectUrl}/functions/v1`).replace(/\/+$/, ""),
    apiBase: (text(env, "CS_TEST_DEPLOY_API_BASE") || "https://api.supabase.com").replace(/\/+$/, ""),
    cli: text(env, "CS_TEST_DEPLOY_CLI") || "supabase",
  };
}
