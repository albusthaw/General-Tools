// Version rules between an app and the server it connects to.

// The first server version that can serve the apps.
export const MIN_SERVER_VERSION = "1.2.0";

export function parseVersion(value) {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(value ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

/** Negative when a is older than b, 0 when equal, positive when newer. */
export function compareVersions(a, b) {
  const left = parseVersion(a) ?? [0, 0, 0];
  const right = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function serverTooOld(serverVersion) {
  return !parseVersion(serverVersion) || compareVersions(serverVersion, MIN_SERVER_VERSION) < 0;
}

/** True when both versions are valid and the candidate is newer than the current one. */
export function isNewerVersion(candidate, current) {
  if (!parseVersion(candidate) || !parseVersion(current)) return false;
  return compareVersions(candidate, current) > 0;
}
