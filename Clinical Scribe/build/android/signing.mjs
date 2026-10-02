// The signing key of the Android app. A phone accepts an update only when it is
// signed with the same key as the app already installed, so the key must be kept.
// It is kept in two GitHub secrets (or environment values on a computer):
//
//   ANDROID_SIGNING_KEY       the key text this build prints the first time
//   ANDROID_SIGNING_PASSWORD  the password that protects it, at least 16 characters
//
// The key text is the key file encrypted with the password (scrypt and AES-256-GCM),
// so it is useless without the password. A plain base64 PKCS12 key file made
// elsewhere is accepted too. Nothing here is ever written into the repository.
import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const KEY_ALIAS = "clinicalscribe";
export const MIN_PASSWORD = 16;
const PREFIX = "CSK1";
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_YEARS = 30;

export class SigningError extends Error {}

/** Returns a problem with the password in plain words, or null when it is fine. */
export function checkPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return `ANDROID_SIGNING_PASSWORD must be at least ${MIN_PASSWORD} characters long. Use a long random password from a password manager.`;
  }
  if (new Set(password).size < 8) {
    return "ANDROID_SIGNING_PASSWORD is too simple. Use a long random password from a password manager.";
  }
  if (/[\r\n]/.test(password)) return "ANDROID_SIGNING_PASSWORD must be one line.";
  return null;
}

function sealingKey(password, salt) {
  return scryptSync(password.normalize("NFC"), salt, 32, SCRYPT);
}

/** The key file, encrypted with the password, as one line of text. */
export function wrapKey(keyFile, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(password, salt), iv);
  cipher.setAAD(Buffer.from(PREFIX));
  const sealed = Buffer.concat([cipher.update(keyFile), cipher.final(), cipher.getAuthTag()]);
  return [PREFIX, salt.toString("base64url"), iv.toString("base64url"), sealed.toString("base64url")].join(".");
}

/** The key file from wrapKey's text. Throws when the password is wrong or the text was changed. */
export function unwrapKey(text, password) {
  const parts = String(text).split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new SigningError("Not a key text from this build.");
  const [salt, iv, sealed] = parts.slice(1).map((part) => Buffer.from(part, "base64url"));
  if (salt.length !== 16 || iv.length !== 12 || sealed.length <= 16) throw new SigningError("The key text is damaged.");
  const decipher = createDecipheriv("aes-256-gcm", sealingKey(password, salt), iv);
  decipher.setAAD(Buffer.from(PREFIX));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
}

/** The key file from ANDROID_SIGNING_KEY: the key text from this build, or a base64 PKCS12 file. */
export function readSavedKey(value, password) {
  const text = String(value ?? "").replace(/\s+/g, "");
  if (text.startsWith(`${PREFIX}.`)) {
    try {
      return unwrapKey(text, password);
    } catch {
      throw new SigningError("ANDROID_SIGNING_KEY could not be opened with ANDROID_SIGNING_PASSWORD. Check that both secrets come from the same build.");
    }
  }
  const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? Buffer.from(text, "base64") : Buffer.alloc(0);
  // A PKCS12 file is a DER sequence, which starts with 0x30.
  if (bytes.length < 200 || bytes[0] !== 0x30) throw new SigningError("ANDROID_SIGNING_KEY is not a signing key. Copy the whole key text again.");
  return bytes;
}

/**
 * How this build is signed:
 *   saved     with the kept key (both values set)
 *   new       with a new key, protected by the password, printed for keeping (password only)
 *   one-time  with a key made for this build only (neither value set)
 */
export function signingPlan(env) {
  const key = String(env.ANDROID_SIGNING_KEY ?? "").trim();
  const password = String(env.ANDROID_SIGNING_PASSWORD ?? "");
  if (key && !password) {
    throw new SigningError("ANDROID_SIGNING_KEY is set but ANDROID_SIGNING_PASSWORD is missing. Add the password as a secret too.");
  }
  if (password) {
    const problem = checkPassword(password);
    if (problem) throw new SigningError(problem);
  }
  if (key) return { kind: "saved", key, password };
  if (password) return { kind: "new", password };
  return { kind: "one-time", password: randomBytes(24).toString("base64url") };
}

function keytool(java, args, password) {
  const tool = java.home ? join(java.home, "bin", process.platform === "win32" ? "keytool.exe" : "keytool") : "keytool";
  const result = spawnSync(tool, args, { encoding: "utf8", env: { ...process.env, CS_KEYSTORE_PASSWORD: password } });
  if (result.error) throw new SigningError("keytool was not found. Install JDK 21 and try again.");
  if (result.status !== 0) throw new SigningError(`keytool did not finish: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
  return result.stdout;
}

/** The first private key's name in keytool -list output, or null. */
export function keyAliasFrom(listing) {
  const match = /^([^,\n]+),[^\n]*PrivateKeyEntry/m.exec(String(listing));
  return match ? match[1].trim() : null;
}

/**
 * Writes the key file for this build into a private folder outside the repository
 * and returns { path, alias, password, kind, keyText }. keyText is only set for a
 * new key, so the person can keep it.
 */
export function prepareKey(plan, folder, java) {
  const path = join(folder, "signing.p12");
  if (plan.kind === "saved") {
    writeFileSync(path, readSavedKey(plan.key, plan.password), { mode: 0o600 });
  } else {
    keytool(java, [
      "-genkeypair", "-noprompt",
      "-keystore", path, "-storetype", "PKCS12",
      "-alias", KEY_ALIAS,
      "-keyalg", "RSA", "-keysize", "4096", "-sigalg", "SHA256withRSA",
      "-validity", String(KEY_YEARS * 365),
      "-dname", "CN=Clinical Scribe",
      "-storepass:env", "CS_KEYSTORE_PASSWORD",
      "-keypass:env", "CS_KEYSTORE_PASSWORD",
    ], plan.password);
  }
  if (!existsSync(path)) throw new SigningError("The signing key could not be written.");
  chmodSync(path, 0o600);
  // English output, so the listing reads the same on every computer.
  const listing = keytool(java, ["-J-Duser.language=en", "-list", "-keystore", path, "-storetype", "PKCS12", "-storepass:env", "CS_KEYSTORE_PASSWORD"], plan.password);
  const alias = keyAliasFrom(listing);
  if (!alias) throw new SigningError("The signing key holds no private key. Check ANDROID_SIGNING_KEY.");
  return { path, alias, password: plan.password, kind: plan.kind, keyText: plan.kind === "new" ? wrapKey(readFileSync(path), plan.password) : "" };
}
