// Adds the connect files (and the Android app, when one is built) to the web build
// for the browser tests, the same way the deploy does, pointing at the local stack.
// Run from the web folder after `npm run build:all`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addPhoneApps } from "../../build/deploy/phone-apps.mjs";
import { parseAppUrl } from "../../build/deploy/settings.mjs";

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = execFileSync("supabase", ["status", "-o", "json"], { cwd: toolRoot, encoding: "utf8" });
const stack = JSON.parse(output.slice(output.indexOf("{")));
const { androidApp } = addPhoneApps(join(toolRoot, "web", "dist"), {
  root: toolRoot,
  projectUrl: stack.API_URL,
  version: readFileSync(join(toolRoot, "VERSION"), "utf8").trim(),
  app: parseAppUrl("http://127.0.0.1:4173/"),
  publishableKey: stack.PUBLISHABLE_KEY ?? stack.ANON_KEY,
});
console.log(`Connect files written${androidApp ? ", with the Android app" : ""}.`);
