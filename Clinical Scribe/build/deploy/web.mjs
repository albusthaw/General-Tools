// The web app part of the deploy: builds the website into web/dist with this
// project's address and publishable key (both public by design), and the phone app
// pages into web/dist/app with no server details at all. Then it adds the connect
// file and the Android app download, and checks that nothing secret ended up in
// the files.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DeployError, done, endSection, info, section } from "./output.mjs";
import { addPhoneApps } from "./phone-apps.mjs";

const windows = process.platform === "win32";
const TEXT_FILE = /\.(html|js|mjs|css|json|webmanifest|txt|svg|map)$/i;

function npm(args, cwd, extraEnv, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(windows ? "npm.cmd" : "npm", args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "inherit", "inherit"],
      // npm is a .cmd file on Windows, which only starts through the shell. The
      // arguments are fixed words, never values from outside.
      shell: windows,
    });
    child.on("error", () => {
      reject(new DeployError("npm was not found. Install Node.js 20.19 or newer from https://nodejs.org and run the deploy again."));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new DeployError(`${label} did not finish. The messages above say why.`));
    });
  });
}

function* filesIn(folder) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) yield* filesIn(path);
    else yield path;
  }
}

function isServerJwt(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return claims?.role === "service_role" || claims?.role === "supabase_admin";
  } catch {
    return false;
  }
}

/** Returns the names of built files that hold anything that must never be public. */
export function findLeaks(folder, secrets) {
  const values = secrets.filter((value) => typeof value === "string" && value.length >= 12);
  const found = new Set();
  for (const path of filesIn(folder)) {
    if (!TEXT_FILE.test(path)) continue;
    const content = readFileSync(path, "utf8");
    const tokens = content.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
    if (
      /sb_secret_[A-Za-z0-9_-]{8,}/.test(content) ||
      /sbp_[A-Za-z0-9]{20,}/.test(content) ||
      values.some((value) => content.includes(value)) ||
      tokens.some(isServerJwt)
    ) {
      found.add(relative(folder, path));
    }
  }
  return [...found];
}

export async function buildWebApp(settings, keys) {
  section("Building the web app");
  const web = join(settings.root, "web");
  await npm(["ci", "--no-audit", "--no-fund"], web, {}, "Installing the web app's packages");
  await npm(
    ["run", "build"],
    web,
    { VITE_SUPABASE_URL: settings.projectUrl, VITE_SUPABASE_PUBLISHABLE_KEY: keys.publishable },
    "Building the web app",
  );

  const dist = join(web, "dist");
  const index = join(dist, "index.html");
  if (!existsSync(index)) throw new DeployError("The web app build did not produce index.html.");
  const origin = new URL(settings.projectUrl).origin;
  if (!readFileSync(index, "utf8").includes(`connect-src 'self' ${origin}`)) {
    throw new DeployError("The built web app is missing its security policy for this project.");
  }

  // The phone app pages ask for the server link, so they are built without one.
  await npm(["run", "build:app"], web, { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" }, "Building the phone app pages");
  const appIndex = join(dist, "app", "index.html");
  if (!existsSync(appIndex) || !readFileSync(appIndex, "utf8").includes("connect-src 'self' https: wss:")) {
    throw new DeployError("The phone app pages were not built with their security policy.");
  }
  const { androidApp } = addPhoneApps(dist, {
    root: settings.root,
    projectUrl: settings.projectUrl,
    version: settings.version,
    app: settings.app,
    publishableKey: keys.publishable,
  });

  const leaks = findLeaks(dist, [keys.secret, settings.accessToken, settings.dbPassword, settings.admin?.password]);
  if (leaks.length > 0) {
    throw new DeployError(`The built web app holds something secret (${leaks.join(", ")}), so it was not published.`);
  }
  done("The web app is built into web/dist and the phone app pages into web/dist/app. Neither holds a secret.");
  if (androidApp) done(`The Android app${androidApp.version ? ` ${androidApp.version}` : ""} is added as a download.`);
  else info("No Android app is in the Release folder, so none is published. Run Build Clinical Scribe Android app to make one.");
  endSection();
  return { dist, androidApp };
}
