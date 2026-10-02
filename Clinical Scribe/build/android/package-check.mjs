// Checks on the finished Android app, read from the output of the Android SDK
// tools (aapt2 and apksigner). Kept free of side effects so the tests can use it.

export const APP_ID = "io.github.albusthaw.clinicalscribe";

// Everything the app may ask for. A library that adds anything else stops the build.
export const EXPECTED_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.VIBRATE",
  `${APP_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
];

/** versionCode for a version: 1.2.3 → 10203 (the same rule as android/app/build.gradle). */
export function versionCodeOf(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99) return null;
  return major * 10000 + minor * 100 + patch;
}

/** The parts of `aapt2 dump badging` output that matter here. */
export function parseBadging(text) {
  const source = String(text);
  const pkg = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m.exec(source);
  return {
    packageName: pkg?.[1] ?? null,
    versionCode: pkg ? Number(pkg[2]) : null,
    versionName: pkg?.[3] ?? null,
    minSdk: Number(/^minSdkVersion:'(\d+)'/m.exec(source)?.[1] ?? 0),
    targetSdk: Number(/^targetSdkVersion:'(\d+)'/m.exec(source)?.[1] ?? 0),
    permissions: [...source.matchAll(/^uses-permission: name='([^']+)'/gm)].map((match) => match[1]),
    debuggable: /^application-debuggable/m.test(source),
  };
}

/** Problems with the package details, in plain words. Empty when all is well. */
export function checkPackage(badging, { version, minSdk = 24, targetSdk = 36 }) {
  const problems = [];
  if (badging.packageName !== APP_ID) problems.push(`The app id is ${badging.packageName}, not ${APP_ID}.`);
  if (badging.versionName !== version) problems.push(`The app version is ${badging.versionName}, not ${version}.`);
  if (badging.versionCode !== versionCodeOf(version)) problems.push(`The version code is ${badging.versionCode}, not ${versionCodeOf(version)}.`);
  if (badging.minSdk !== minSdk) problems.push(`The app needs Android API ${badging.minSdk}, not ${minSdk}.`);
  if (badging.targetSdk !== targetSdk) problems.push(`The app targets Android API ${badging.targetSdk}, not ${targetSdk}.`);
  if (badging.debuggable) problems.push("The app is debuggable.");
  const extra = badging.permissions.filter((name) => !EXPECTED_PERMISSIONS.includes(name));
  if (extra.length) problems.push(`The app asks for permissions it should not: ${extra.join(", ")}.`);
  return problems;
}

/** Problems with the compiled manifest (`aapt2 dump xmltree --file AndroidManifest.xml`). */
export function checkManifestTree(text) {
  const source = String(text);
  const problems = [];
  if (!/:allowBackup\(0x[0-9a-f]+\)=false/.test(source)) problems.push("Backups are not switched off.");
  if (!/:usesCleartextTraffic\(0x[0-9a-f]+\)=false/.test(source)) problems.push("Plain http traffic is not switched off.");
  if (!/:networkSecurityConfig\(0x[0-9a-f]+\)=@/.test(source)) problems.push("The network security settings are missing.");
  if (/:debuggable\(0x[0-9a-f]+\)=true/.test(source)) problems.push("The app is debuggable.");
  return problems;
}

/** The signature details from `apksigner verify --verbose --print-certs`. */
export function parseSigner(text) {
  const source = String(text);
  const scheme = (name) => new RegExp(`Verified using ${name} scheme[^:]*: true`).test(source);
  return {
    verified: /^Verifies$/m.test(source),
    v2: scheme("v2"),
    v3: scheme("v3"),
    signers: Number(/^Number of signers: (\d+)/m.exec(source)?.[1] ?? 0),
    certificateSha256: /^Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})$/m.exec(source)?.[1] ?? null,
  };
}

/** Problems with the files inside the app (`jar tf` listing). */
export function checkEntries(listing) {
  const entries = String(listing).split(/\r?\n/).filter(Boolean);
  const problems = [];
  if (!entries.includes("assets/public/index.html")) problems.push("The app pages are missing.");
  if (entries.some((entry) => entry.endsWith(".map"))) problems.push("The app holds source maps.");
  if (entries.some((entry) => entry.startsWith("assets/public/launch/"))) problems.push("The app holds the iPhone launch images.");
  if (entries.some((entry) => /(^|\/)\.env|\.p12$|\.jks$|\.keystore$/i.test(entry))) problems.push("The app holds a settings or key file.");
  return problems;
}
