// The server part of the deploy: database, server functions and their settings,
// sign-in settings and the first admin. Every step is safe to repeat.
import { runCli } from "./cli.mjs";
import { sleep } from "./http.mjs";
import { pickKeys } from "./management-api.mjs";
import { riskyMigrations } from "./migrations.mjs";
import { DeployError, done, endSection, info, mask, section, warn } from "./output.mjs";
import { projectApi } from "./project-api.mjs";

// "Letters and digits", in the form the Management API expects.
const LETTERS_AND_DIGITS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";
const STARTING = new Set(["COMING_UP", "RESTORING", "UPGRADING", "RESTARTING", "RESIZING", "UNKNOWN"]);
const PAUSED = new Set(["INACTIVE", "PAUSING", "GOING_DOWN"]);

// Waits while a new project is still starting; stops at once for a paused one.
export async function waitForProject(api, { timeoutMs = 600_000, pollMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const project = await api.project();
    const status = String(project?.status ?? "UNKNOWN");
    if (status === "ACTIVE_HEALTHY") return project;
    if (status === "ACTIVE_UNHEALTHY") {
      warn("Supabase reports the project as running but not fully healthy. The deploy carries on.");
      return project;
    }
    if (PAUSED.has(status)) {
      throw new DeployError("The Supabase project is paused. Restore it from the Supabase dashboard, then run the deploy again.");
    }
    if (!STARTING.has(status)) {
      throw new DeployError(`The Supabase project cannot be used right now (status ${status}). Check it in the Supabase dashboard.`);
    }
    if (Date.now() > deadline) {
      throw new DeployError("The Supabase project is still starting. Wait a few minutes, then run the deploy again.");
    }
    info("The project is still starting. Waiting…");
    await sleep(pollMs);
  }
}

export async function readKeys(api) {
  const keys = pickKeys(await api.apiKeys());
  mask(keys.publishable);
  mask(keys.secret);
  if (!keys.publishable || !keys.secret) {
    throw new DeployError("The project's API keys could not be read. Check that the access token belongs to an account that can manage the project.");
  }
  return keys;
}

// Nobody can sign themselves up, email sign-in stays on and the password rule
// matches the app. Addresses already allowed (for example by Google sign-in) are kept.
export function signInPatch(current, app) {
  const patch = {
    disable_signup: true,
    external_email_enabled: true,
    password_min_length: Math.max(10, Number(current?.password_min_length) || 0),
  };
  if (!current?.password_required_characters) patch.password_required_characters = LETTERS_AND_DIGITS;
  if (app) {
    const allowed = String(current?.uri_allow_list ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const entry of [app.url, `${app.url}**`]) {
      if (!allowed.includes(entry)) allowed.push(entry);
    }
    patch.uri_allow_list = allowed.join(",");
    patch.site_url = app.url;
  }
  return patch;
}

// Kinds of records the deploy counts before and after it updates the database.
const COUNTED = {
  people: "people",
  recordings: "recordings",
  notes: "notes",
  templates: "templates",
  audit_entries: "audit log entries",
  credit_entries: "minutes history entries",
};

/** Kinds of records that became fewer, with how many fewer. */
export function compareCounts(before, after) {
  const drops = [];
  for (const [key, label] of Object.entries(COUNTED)) {
    const was = Number(before?.[key]);
    const now = Number(after?.[key]);
    if (Number.isFinite(was) && Number.isFinite(now) && now < was) drops.push({ key, label, was, now, lost: was - now });
  }
  return drops;
}

// A few records can be deleted by people while the deploy runs; a whole table
// emptied, more than a couple gone, or any audit entry gone is never normal.
export function isSerious(drop) {
  return drop.now === 0 || drop.lost > 2 || drop.key === "audit_entries";
}

function checkCounts(before, after) {
  const drops = compareCounts(before, after);
  const list = drops.map((drop) => `${drop.lost} ${drop.label}`).join(", ");
  if (drops.some(isSerious)) {
    throw new DeployError(
      `Some records are missing after the database update (${list} fewer than before). Restore the latest backup in Supabase (Database → Backups) before anyone uses the app, and report this problem.`,
    );
  }
  if (drops.length > 0) warn(`A few records were deleted while the deploy ran (${list}). This is normal if someone deleted them at the same time.`);
  else done("All records are still there: people, recordings, notes, templates, minutes and the audit log.");
}

// Runs before the database is touched: no migration may drop or empty a table.
export function checkDatabaseChanges(settings) {
  section("Checking the database changes");
  const risky = riskyMigrations(settings.root);
  if (risky.length > 0) {
    throw new DeployError(
      `The update was stopped before anything changed: ${risky.map((found) => found.file).join(", ")} would remove stored records. Report this problem; do not edit the file yourself.`,
    );
  }
  done("No database change removes stored records.");
  endSection();
}

async function firstAdmin(settings, project) {
  if (!settings.admin) {
    info("No admin details were given, so no account was made.");
    info("Add a person under Authentication → Users in Supabase: the first account becomes the admin.");
    return "not_requested";
  }
  if (await project.hasAccounts()) {
    info("The project already has accounts, so no new admin was made.");
    return "exists";
  }
  const outcome = await project.createAccount(settings.admin);
  if (outcome === "created") done("The first admin account is ready.");
  else info("That email address already has an account, so no new admin was made.");
  return outcome;
}

export async function deployServer(settings, api, keys) {
  // First of all, so nobody can create an account on a new project while the rest
  // of the deploy runs.
  section("Applying the sign-in settings");
  const current = await api.authConfig();
  await api.updateAuthConfig(signInPatch(current, settings.app));
  done("Public sign-up is off: only people added by an admin can sign in.");
  if (settings.app) done(`After signing in, people return to ${settings.app.url}`);
  endSection();

  checkDatabaseChanges(settings);

  // Counted before any database change, so the deploy can prove nothing was lost.
  // Servers older than 1.1.0 have no counting function yet.
  const project = projectApi(settings, keys.secret);
  const before = await project.optionalRpc("svc_data_summary");

  section("Connecting to the Supabase project");
  await runCli(settings, ["link", "--project-ref", settings.ref, "--yes"], "Connecting to the project");
  done("Connected.");
  endSection();

  section("Updating the database");
  await runCli(settings, ["db", "push", "--linked", "--yes"], "Updating the database");
  done("The database is up to date. Existing records are kept.");
  endSection();

  section("Publishing the server functions");
  // Each function checks the caller itself, as the newer API keys require.
  await runCli(
    settings,
    ["functions", "deploy", "--project-ref", settings.ref, "--no-verify-jwt", "--use-api", "--yes"],
    "Publishing the server functions",
  );
  done("The server functions are published.");
  endSection();

  section("Saving the server function settings");
  const secrets = [{ name: "CS_PROJECT_REF", value: settings.ref }];
  if (settings.app) secrets.push({ name: "CS_ALLOWED_ORIGINS", value: settings.app.origin });
  await api.setSecrets(secrets);
  if (settings.app) done(`Only pages from ${settings.app.origin} may call the server functions.`);
  else warn("No app address was given, so pages from any address may call the server functions. Every call still needs a valid sign-in.");
  endSection();

  section("Checking that every record is kept");
  try {
    const after = await project.rpc("svc_data_summary", {}, "count the records");
    if (before) checkCounts(before, after);
    else info("This server had no record count from before the update; from now on every update is checked.");
  } catch (error) {
    if (error instanceof DeployError && /Some records are missing/.test(error.message)) throw error;
    warn("The records could not be counted after the update, so this check was skipped.");
  }
  endSection();

  section("Recording the version on the server");
  await project.rpc("svc_set_functions_url", { p_url: settings.functionsUrl }, "record the server functions address");
  await project.rpc("svc_set_server_version", { p_version: settings.version }, "record the version");
  done(`The server runs version ${settings.version}.`);
  endSection();

  section("First admin");
  const admin = await firstAdmin(settings, project);
  endSection();
  return { admin };
}
