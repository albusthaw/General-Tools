// Unit tests for the Android build helpers: the signing key text, the signing plan,
// the checks on the finished app, and the Android part of Release/README.txt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEntries, checkManifestTree, checkPackage, EXPECTED_PERMISSIONS, parseBadging, parseSigner, versionCodeOf } from "../../build/android/package-check.mjs";
import { androidSection, readAndroidRelease, withAndroidSection } from "../../build/android/release-file.mjs";
import { checkPassword, keyAliasFrom, readSavedKey, SigningError, signingPlan, unwrapKey, wrapKey } from "../../build/android/signing.mjs";

const PASSWORD = "Tq8-vLm2_Rx9pZc4Wn7s";

test("the key text opens only with the right password and only when unchanged", () => {
  const keyFile = Buffer.concat([Buffer.from([0x30, 0x82]), Buffer.alloc(300, 7)]);
  const text = wrapKey(keyFile, PASSWORD);
  assert.match(text, /^CSK1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!text.includes(keyFile.toString("base64")), "the key file is not readable in the text");
  assert.deepEqual(unwrapKey(text, PASSWORD), keyFile);
  assert.notEqual(wrapKey(keyFile, PASSWORD), text, "each text uses a fresh salt");
  assert.throws(() => unwrapKey(text, `${PASSWORD}x`));
  const parts = text.split(".");
  const changed = Buffer.from(parts[3], "base64url");
  changed[0] ^= 1;
  assert.throws(() => unwrapKey([...parts.slice(0, 3), changed.toString("base64url")].join("."), PASSWORD));
  assert.throws(() => unwrapKey("CSK1.abc", PASSWORD), SigningError);

  assert.deepEqual(readSavedKey(`  ${text.slice(0, 40)}\n${text.slice(40)} `, PASSWORD), keyFile, "line breaks from copying are fine");
  assert.throws(() => readSavedKey(text, "a-different-password-123"), /could not be opened/);
  assert.deepEqual(readSavedKey(keyFile.toString("base64"), PASSWORD), keyFile, "a plain base64 key file is accepted");
  assert.throws(() => readSavedKey("not a key", PASSWORD), /not a signing key/);
  assert.throws(() => readSavedKey(Buffer.alloc(300, 1).toString("base64"), PASSWORD), /not a signing key/);
});

test("the signing plan follows the secrets that are set", () => {
  assert.equal(signingPlan({}).kind, "one-time");
  assert.ok(signingPlan({}).password.length >= 30, "a one-time key still gets a strong password");
  assert.deepEqual(signingPlan({ ANDROID_SIGNING_PASSWORD: PASSWORD }), { kind: "new", password: PASSWORD });
  assert.deepEqual(signingPlan({ ANDROID_SIGNING_PASSWORD: PASSWORD, ANDROID_SIGNING_KEY: " CSK1.a.b.c " }), { kind: "saved", key: "CSK1.a.b.c", password: PASSWORD });
  assert.throws(() => signingPlan({ ANDROID_SIGNING_KEY: "CSK1.a.b.c" }), /ANDROID_SIGNING_PASSWORD is missing/);
  assert.throws(() => signingPlan({ ANDROID_SIGNING_PASSWORD: "short" }), /at least 16 characters/);
  assert.equal(checkPassword("aaaaaaaaaaaaaaaaaaaa")?.includes("too simple"), true);
  assert.equal(checkPassword(`${PASSWORD}\n`)?.includes("one line"), true);
  assert.equal(checkPassword(PASSWORD), null);
});

test("the private key name is read from the key listing", () => {
  const listing = "Keystore type: PKCS12\nKeystore provider: SUN\n\nYour keystore contains 1 entry\n\nclinicalscribe, Oct 2, 2026, PrivateKeyEntry, \nCertificate fingerprint (SHA-256): AB:CD\n";
  assert.equal(keyAliasFrom(listing), "clinicalscribe");
  assert.equal(keyAliasFrom("other, Oct 2, 2026, trustedCertEntry,\n"), null);
});

const BADGING = `package: name='io.github.albusthaw.clinicalscribe' versionCode='10200' versionName='1.2.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'24'
targetSdkVersion:'36'
${EXPECTED_PERMISSIONS.map((name) => `uses-permission: name='${name}'`).join("\n")}
application-label:'Clinical Scribe'
launchable-activity: name='io.github.albusthaw.clinicalscribe.MainActivity'  label='Clinical Scribe' icon=''
`;

test("the app details are checked: id, version, Android level, permissions, not debuggable", () => {
  const details = parseBadging(BADGING);
  assert.equal(details.packageName, "io.github.albusthaw.clinicalscribe");
  assert.equal(details.versionCode, 10200);
  assert.equal(details.minSdk, 24);
  assert.deepEqual(checkPackage(details, { version: "1.2.0" }), []);
  assert.equal(versionCodeOf("1.2.0"), 10200);
  assert.equal(versionCodeOf("2.10.3"), 21003);
  assert.equal(versionCodeOf("1.100.0"), null);

  const wrong = parseBadging(`${BADGING.replace("10200", "10100")}uses-permission: name='android.permission.READ_CONTACTS'\napplication-debuggable\n`);
  const problems = checkPackage(wrong, { version: "1.2.0" }).join(" ");
  assert.match(problems, /version code is 10100/);
  assert.match(problems, /READ_CONTACTS/);
  assert.match(problems, /debuggable/);
  assert.match(checkPackage(details, { version: "1.3.0" }).join(" "), /version is 1\.2\.0, not 1\.3\.0/);
});

test("the compiled app settings are checked", () => {
  const good = [
    "A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false",
    "A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=false",
    "A: http://schemas.android.com/apk/res/android:networkSecurityConfig(0x01010527)=@0x7f100003",
  ].join("\n");
  assert.deepEqual(checkManifestTree(good), []);
  const bad = good.replace("allowBackup(0x01010280)=false", "allowBackup(0x01010280)=true").replace("usesCleartextTraffic(0x010104ec)=false", "") + "\nA: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true";
  assert.equal(checkManifestTree(bad).length, 3);
});

test("the signature details are read from apksigner", () => {
  const output = [
    "Verifies",
    "Verified using v1 scheme (JAR signing): false",
    "Verified using v2 scheme (APK Signature Scheme v2): true",
    "Verified using v3 scheme (APK Signature Scheme v3): true",
    "Number of signers: 1",
    `Signer #1 certificate SHA-256 digest: ${"ab".repeat(32)}`,
  ].join("\n");
  assert.deepEqual(parseSigner(output), { verified: true, v2: true, v3: true, signers: 1, certificateSha256: "ab".repeat(32) });
  assert.equal(parseSigner("DOES NOT VERIFY").verified, false);
});

test("the files inside the app are checked", () => {
  const good = "AndroidManifest.xml\nassets/public/index.html\nassets/public/assets/index-abc.js\nclasses.dex\n";
  assert.deepEqual(checkEntries(good), []);
  assert.equal(checkEntries("classes.dex\n").length, 1);
  assert.equal(checkEntries(`${good}assets/public/assets/index-abc.js.map\n`).length, 1);
  assert.equal(checkEntries(`${good}assets/public/launch/launch-750x1334.png\n`).length, 1);
  assert.equal(checkEntries(`${good}assets/public/.env\n`).length, 1);
  assert.equal(checkEntries(`${good}assets/signing.p12\n`).length, 1);
});

test("the Release notes name the Android app, and the deploy reads its version back", () => {
  const section = androidSection({ version: "1.2.0", versionCode: 10200, size: 3_800_000, sha256: "f".repeat(64), keyKind: "saved", date: "2026-10-02" });
  assert.match(section, /^Android app: clinical-scribe\.apk\n {2}Version 1\.2\.0 \(code 10200\), 3\.6 MB\n/);
  assert.match(section, /kept signing key/);
  const readme = "Clinical Scribe - Release folder\n\nThe version number is in the VERSION file.\n";
  const once = withAndroidSection(readme, section);
  assert.ok(once.startsWith(readme.trimEnd()));
  assert.deepEqual(readAndroidRelease(once), { version: "1.2.0", versionCode: 10200 });
  const newer = androidSection({ version: "1.3.0", versionCode: 10300, size: 1, sha256: "e".repeat(64), keyKind: "one-time", date: "2026-11-01" });
  const twice = withAndroidSection(once, newer);
  assert.equal(twice.split("Android app: clinical-scribe.apk").length, 2, "the section is replaced, not repeated");
  assert.deepEqual(readAndroidRelease(twice), { version: "1.3.0", versionCode: 10300 });
  assert.match(twice, /one-time key/);
  assert.equal(readAndroidRelease(readme), null);
});
