#!/usr/bin/env node
// Sets up Clinical Scribe on a Supabase project, or upgrades one that is already
// set up. Every step is safe to repeat, so an upgrade is the same command run
// again. The README lists the values it needs.
//
//   node build/deploy/deploy.mjs          everything: web app and server
//   node build/deploy/deploy.mjs server   database, server functions and settings
//   node build/deploy/deploy.mjs web      the web app only, built into web/dist
//   node build/deploy/deploy.mjs check    checks the values and the project; changes nothing
import { parseCliVersion, runCli } from "./cli.mjs";
import { managementApi } from "./management-api.mjs";
import { DeployError, done, endSection, failure, mask, scrub, section, setOutput, summary, warn } from "./output.mjs";
import { deployServer, readKeys, waitForProject } from "./server.mjs";
import { readSettings } from "./settings.mjs";
import { buildWebApp } from "./web.mjs";

const PLANS = {
  all: { server: true, web: true },
  server: { server: true, web: false },
  web: { server: false, web: true },
  check: { server: true, web: true, checkOnly: true },
};

const ADMIN_TEXT = {
  created: "Created. Sign in with the admin email address and password you provided.",
  exists: "The project already has accounts, so no new one was made.",
  not_requested: "Not requested. Add a person under Authentication → Users in Supabase; the first account becomes the admin.",
};

function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 19)) {
    throw new DeployError(`Node.js 20.19 or newer is needed; this computer has ${process.versions.node}.`);
  }
}

async function checkCli(settings) {
  const version = parseCliVersion(await runCli(settings, ["--version"], "Checking the Supabase tool", { quiet: true }));
  if (!version || version[0] < 2) {
    throw new DeployError("The Supabase command-line tool is too old. Update it to the newest version and run the deploy again.");
  }
  if (version[0] === 2 && version[1] < 50) {
    warn(`The Supabase command-line tool is version ${version.join(".")}. If a step fails, update it to the newest version.`);
  }
}

function report(settings, plan, server) {
  const lines = [`## Clinical Scribe ${settings.version}`];
  if (plan.checkOnly) {
    lines.push("", "Everything the deploy needs is in place. Nothing was changed.");
    return lines;
  }
  lines.push("");
  if (plan.server) lines.push("- **Server:** the database, server functions and sign-in settings are up to date.");
  if (plan.web) lines.push("- **Web app:** built and checked for secrets.");
  if (settings.app) lines.push(`- **App address:** ${settings.app.url}`);
  else if (plan.web) lines.push("- **App address:** put the files in web/dist on any static web host (see the README).");
  if (server) lines.push(`- **First admin:** ${ADMIN_TEXT[server.admin] ?? ADMIN_TEXT.exists}`);
  return lines;
}

async function main() {
  const name = process.argv[2] ?? "all";
  const plan = PLANS[name];
  if (!plan) throw new DeployError(`Unknown part "${name}". Use all, server, web or check.`);
  checkNode();

  const settings = readSettings(process.env, plan);
  mask(settings.accessToken);
  mask(settings.dbPassword);
  if (settings.admin) mask(settings.admin.password);

  section("Checking the Supabase project");
  const api = managementApi(settings);
  await waitForProject(api);
  const keys = await readKeys(api);
  if (plan.server) await checkCli(settings);
  done("The project is ready and the access token works.");
  endSection();

  let server = null;
  if (!plan.checkOnly) {
    // The web app is built first, so a failed build stops the deploy before the
    // server is changed.
    if (plan.web) await buildWebApp(settings, keys);
    if (plan.server) server = await deployServer(settings, api, keys);
    if (settings.app) setOutput("app_url", settings.app.url);
  }
  summary(report(settings, plan, server));
}

main().catch((error) => {
  failure(error instanceof DeployError ? error.message : `Something unexpected went wrong: ${scrub(error?.message)}`);
  process.exitCode = 1;
});
