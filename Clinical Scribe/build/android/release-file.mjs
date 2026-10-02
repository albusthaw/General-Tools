// The Android part of Release/README.txt: how the app in the Release folder was
// built. build-apk.mjs writes it, and the deploy reads the version from it when it
// publishes the app with the website.

export const ANDROID_HEADING = "Android app: clinical-scribe.apk";
const KEY_TEXT = {
  saved: "Signed with the kept signing key, so it installs over earlier copies.",
  new: "Signed with a new signing key. Keep the key (see README.md) so later copies install over this one.",
  "one-time": "Signed with a one-time key. Remove this app from a phone before installing a later copy.",
};

/** The README section for a built app. */
export function androidSection({ version, versionCode, size, sha256, keyKind, date }) {
  return [
    ANDROID_HEADING,
    `  Version ${version} (code ${versionCode}), ${(size / (1024 * 1024)).toFixed(1)} MB`,
    `  SHA-256 ${sha256}`,
    `  ${KEY_TEXT[keyKind] ?? KEY_TEXT["one-time"]}`,
    `  Built on ${date} with: node build/android/build-apk.mjs`,
    "",
  ].join("\n");
}

/** The README with its Android section replaced (or added at the end). */
export function withAndroidSection(readme, section) {
  const text = String(readme ?? "").replace(/\r\n/g, "\n");
  const start = text.indexOf(ANDROID_HEADING);
  const before = (start < 0 ? text : text.slice(0, start)).replace(/\n*$/, "");
  return `${before}\n\n${section}`;
}

/** { version, versionCode } of the app named in the README, or null. */
export function readAndroidRelease(readme) {
  const text = String(readme ?? "");
  const start = text.indexOf(ANDROID_HEADING);
  if (start < 0) return null;
  const match = /^\s*Version (\d{1,4}\.\d{1,4}\.\d{1,4}) \(code (\d{1,9})\)/m.exec(text.slice(start + ANDROID_HEADING.length));
  return match ? { version: match[1], versionCode: Number(match[2]) } : null;
}
