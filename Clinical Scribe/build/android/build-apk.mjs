#!/usr/bin/env node
// Builds the Android app into Release/clinical-scribe.apk from the app build of the
// web app, then signs and checks it. Run from the Clinical Scribe folder:
//
//   node build/android/build-apk.mjs
//
// Needs Node.js 22, JDK 21 and the Android SDK with platform 36 and the build
// tools; GitHub's Ubuntu runners have all of them. The signing key comes from
// ANDROID_SIGNING_KEY and ANDROID_SIGNING_PASSWORD (see signing.mjs). Without
// them the app is signed with a one-time key.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { done, failure, info, mask, section, setOutput, summary, warn } from "../deploy/output.mjs";
import { findLeaks } from "../deploy/web.mjs";
import { checkEntries, checkManifestTree, checkPackage, parseBadging, parseSigner, versionCodeOf } from "./package-check.mjs";
import { androidSection, withAndroidSection } from "./release-file.mjs";
import { prepareKey, SigningError, signingPlan } from "./signing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "web");
const android = join(root, "android");
const windows = process.platform === "win32";
const APK_NAME = "clinical-scribe.apk";

class BuildError extends Error {}

function run(command, args, { cwd = root, env = {}, capture = false, label }) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    // npm, npx and gradlew are .cmd or .bat files on Windows, which only start
    // through the shell. The arguments are fixed words, never values from outside.
    shell: windows && /\.(cmd|bat)$/i.test(command),
  });
  if (result.error) throw new BuildError(`${label}: ${command} was not found.`);
  if (result.status !== 0) {
    const detail = capture ? `\n${(result.stderr || result.stdout || "").trim().slice(-1200)}` : " The messages above say why.";
    throw new BuildError(`${label} did not finish.${detail}`);
  }
  return result.stdout ?? "";
}

function findJava() {
  const home = process.env.JAVA_HOME || "";
  const java = home ? join(home, "bin", windows ? "java.exe" : "java") : "java";
  const result = spawnSync(java, ["-version"], { encoding: "utf8" });
  const major = Number(/version "(\d+)/.exec(`${result.stderr}${result.stdout}`)?.[1] ?? 0);
  if (result.error || major < 21) {
    throw new BuildError("JDK 21 or newer is needed. Install it (for example Temurin 21) and set JAVA_HOME, then try again.");
  }
  return { home, major, tool: (name) => (home ? join(home, "bin", windows ? `${name}.exe` : name) : name) };
}

function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    windows ? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk") : null,
    process.platform === "darwin" ? join(homedir(), "Library", "Android", "sdk") : join(homedir(), "Android", "Sdk"),
  ].filter(Boolean);
  const sdk = candidates.find((folder) => existsSync(join(folder, "build-tools")));
  if (!sdk) throw new BuildError("The Android SDK was not found. Install it (Android Studio or the command-line tools) and set ANDROID_HOME, then try again.");
  const versions = readdirSync(join(sdk, "build-tools"))
    .filter((name) => /^\d+\.\d+\.\d+/.test(name))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const exe = (name) => (windows ? { apksigner: "apksigner.bat", zipalign: "zipalign.exe", aapt2: "aapt2.exe" }[name] : name);
  for (const version of versions) {
    const folder = join(sdk, "build-tools", version);
    if (["apksigner", "zipalign", "aapt2"].every((name) => existsSync(join(folder, exe(name))))) {
      return { sdk, buildTools: version, tool: (name) => join(folder, exe(name)) };
    }
  }
  throw new BuildError("The Android build tools were not found. Install build tools 36 with the Android SDK Manager, then try again.");
}

function checkTools() {
  section("Checking the tools");
  const node = Number(process.versions.node.split(".")[0]);
  if (node < 22) throw new BuildError(`Node.js 22 or newer is needed; this computer has ${process.versions.node}.`);
  const java = findJava();
  const sdk = findSdk();
  done(`Node.js ${process.versions.node}, JDK ${java.major}, Android build tools ${sdk.buildTools}`);
  return { java, sdk };
}

function buildPages() {
  section("Building the app pages");
  const npm = windows ? "npm.cmd" : "npm";
  if (!existsSync(join(web, "node_modules"))) run(npm, ["ci", "--no-audit", "--no-fund"], { cwd: web, label: "Installing the web app's packages" });
  run(npm, ["run", "build:app"], { cwd: web, label: "Building the app pages" });
  const leaks = findLeaks(join(web, "dist", "app"), []);
  if (leaks.length) throw new BuildError(`The app pages hold something secret: ${leaks.join(", ")}. Nothing was built.`);
  run(windows ? "npx.cmd" : "npx", ["cap", "sync", "android"], { cwd: web, label: "Copying the app pages into the Android project" });
  done("The app pages are built and hold no keys.");
}

function buildApp(sdk) {
  section("Building the Android app");
  const gradlew = windows ? join(android, "gradlew.bat") : "./gradlew";
  run(gradlew, ["--no-daemon", "--console=plain", ":app:assembleRelease", ":app:testReleaseUnitTest", ":app:lintRelease"], {
    cwd: android,
    env: { ANDROID_HOME: sdk.sdk },
    label: "The Android build",
  });
  const unsigned = join(android, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk");
  if (!existsSync(unsigned)) throw new BuildError("The Android build finished without an app file.");
  done("Built; the Android tests and checks passed.");
  return unsigned;
}

function signApp(unsigned, { java, sdk }) {
  section("Signing the app");
  const plan = signingPlan(process.env);
  mask(plan.password);
  const folder = mkdtempSync(join(tmpdir(), "cs-signing-"));
  chmodSync(folder, 0o700);
  const outputs = dirname(unsigned);
  const aligned = join(outputs, "app-release-aligned.apk");
  const signed = join(outputs, "app-release-signed.apk");
  try {
    const key = prepareKey(plan, folder, java);
    run(sdk.tool("zipalign"), ["-f", "4", unsigned, aligned], { capture: true, label: "Aligning the app file" });
    run(sdk.tool("apksigner"), [
      "sign",
      "--ks", key.path, "--ks-type", "PKCS12", "--ks-key-alias", key.alias,
      "--ks-pass", "env:CS_KEYSTORE_PASSWORD", "--key-pass", "env:CS_KEYSTORE_PASSWORD",
      "--v1-signing-enabled", "false", "--v2-signing-enabled", "true",
      "--v3-signing-enabled", "true", "--v4-signing-enabled", "false",
      "--out", signed, aligned,
    ], { capture: true, env: { CS_KEYSTORE_PASSWORD: key.password }, label: "Signing the app" });
    done({ saved: "Signed with the kept signing key.", new: "Signed with a new signing key.", "one-time": "Signed with a one-time key." }[key.kind]);
    return { signed, kind: key.kind, keyText: key.keyText };
  } finally {
    rmSync(folder, { recursive: true, force: true });
    rmSync(aligned, { force: true });
  }
}

function checkApp(signed, version, { java, sdk }) {
  section("Checking the app");
  const signer = parseSigner(run(sdk.tool("apksigner"), ["verify", "--verbose", "--print-certs", signed], { capture: true, label: "Checking the signature" }));
  const problems = [];
  if (!signer.verified || !(signer.v2 || signer.v3) || signer.signers !== 1) problems.push("The signature does not check out.");
  problems.push(...checkPackage(parseBadging(run(sdk.tool("aapt2"), ["dump", "badging", signed], { capture: true, label: "Reading the app details" })), { version }));
  problems.push(...checkManifestTree(run(sdk.tool("aapt2"), ["dump", "xmltree", "--file", "AndroidManifest.xml", signed], { capture: true, label: "Reading the app settings" })));
  problems.push(...checkEntries(run(java.tool("jar"), ["tf", signed], { capture: true, label: "Listing the app files" })));
  if (problems.length) throw new BuildError(`The app did not pass its checks:\n- ${problems.join("\n- ")}`);
  done("Signature, app id, version, permissions and settings are right.");
  return signer;
}

function save(signed, version, signing) {
  section("Saving the app");
  const release = join(root, "Release");
  mkdirSync(release, { recursive: true });
  const target = join(release, APK_NAME);
  copyFileSync(signed, target);
  const bytes = readFileSync(target);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const readmePath = join(release, "README.txt");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "Clinical Scribe - Release folder\n";
  const notes = androidSection({ version, versionCode: versionCodeOf(version), size: statSync(target).size, sha256, keyKind: signing.kind, date: new Date().toISOString().slice(0, 10) });
  writeFileSync(readmePath, withAndroidSection(readme, notes));
  done(`${relative(root, target)} (${(bytes.length / (1024 * 1024)).toFixed(1)} MB)`);
  info(`SHA-256 ${sha256}`);
  setOutput("apk", relative(root, target));

  let keyFile = "";
  if (signing.keyText) {
    const folder = join(android, "build", "signing-key");
    mkdirSync(folder, { recursive: true });
    keyFile = join(folder, "ANDROID_SIGNING_KEY.txt");
    writeFileSync(keyFile, `${signing.keyText}\n`, { mode: 0o600 });
  }
  setOutput("new_key", signing.keyText ? "true" : "false");
  return { target, sha256, keyFile };
}

function report(version, signing, saved) {
  const onGitHub = process.env.GITHUB_ACTIONS === "true";
  const lines = [`## Clinical Scribe Android app ${version}`, "", `- **App file:** Release/${APK_NAME}`, `- **SHA-256:** ${saved.sha256}`];
  if (signing.kind === "saved") {
    lines.push("- **Signing:** the kept signing key, so the app installs over earlier copies.");
  } else if (signing.kind === "new") {
    lines.push("- **Signing:** a new signing key, protected by ANDROID_SIGNING_PASSWORD.", "", "### Keep the signing key", "");
    if (onGitHub) {
      lines.push(
        "1. On this run's page, under **Artifacts**, download **android-signing-key**. It is kept for one day only.",
        "2. Open the file inside and copy all of its text.",
        "3. In the repository, open **Settings → Secrets and variables → Actions → New repository secret**.",
        "4. Name it **ANDROID_SIGNING_KEY**, paste the text and save.",
        "5. Delete the downloaded file. Later builds use the kept key, so phones accept updates.",
      );
    } else {
      lines.push(
        `1. Open ${relative(root, saved.keyFile)} and copy all of its text.`,
        "2. Keep it as ANDROID_SIGNING_KEY (a GitHub secret, or an environment value on this computer) together with the same ANDROID_SIGNING_PASSWORD.",
        "3. Delete the file. Later builds use the kept key, so phones accept updates.",
      );
    }
  } else {
    lines.push(
      "- **Signing:** a one-time key. Phones must remove this app before installing a later copy.",
      "",
      "To sign every build with the same key, add a repository secret **ANDROID_SIGNING_PASSWORD** with a long random password (at least 16 characters) and run this build again. README.md explains the steps.",
    );
  }
  summary(lines);
}

async function main() {
  const version = readFileSync(join(root, "VERSION"), "utf8").trim();
  if (!versionCodeOf(version)) throw new BuildError(`The VERSION file must look like 1.2.0, not "${version}".`);
  const tools = checkTools();
  buildPages();
  const unsigned = buildApp(tools.sdk);
  const signing = signApp(unsigned, tools);
  checkApp(signing.signed, version, tools);
  const saved = save(signing.signed, version, signing);
  if (signing.kind === "one-time") warn("The app is signed with a one-time key. See the steps below to keep one key for every build.");
  report(version, signing, saved);
}

main().catch((error) => {
  if (error instanceof BuildError || error instanceof SigningError) failure(error.message);
  else failure(`The build stopped unexpectedly: ${error?.message ?? error}`);
  process.exitCode = 1;
});
