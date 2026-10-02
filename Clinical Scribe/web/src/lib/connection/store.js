// The servers an app has connected to, kept on this device. Only public details
// are saved: the server address, its public key, its name and the link typed.
import { isSavedConnection } from "./validate.js";

const KEY = "cs-connections";
const MAX_RECENT = 5;

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const list = Array.isArray(data?.list) ? data.list.filter(isSavedConnection).slice(0, MAX_RECENT) : [];
    const current = list.some((item) => item.serverUrl === data?.current) ? data.current : null;
    return { current, list };
  } catch {
    return { current: null, list: [] };
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage can be full or switched off; the app then asks again next time.
  }
}

export function currentConnection() {
  const data = read();
  return data.list.find((item) => item.serverUrl === data.current) ?? null;
}

export function recentConnections() {
  return read().list;
}

/** Saves a connection as the current one, at the top of the recent list. */
export function rememberConnection(connection) {
  const data = read();
  const saved = {
    serverUrl: connection.serverUrl,
    publishableKey: connection.publishableKey,
    name: connection.name ?? "",
    link: connection.link,
    siteUrl: connection.siteUrl ?? "",
    appUrl: connection.appUrl ?? "",
    version: connection.version ?? "",
    connectedAt: new Date().toISOString(),
  };
  const list = [saved, ...data.list.filter((item) => item.serverUrl !== saved.serverUrl)].slice(0, MAX_RECENT);
  write({ current: saved.serverUrl, list });
  return saved;
}

export function forgetConnection(serverUrl) {
  const data = read();
  write({ current: data.current === serverUrl ? null : data.current, list: data.list.filter((item) => item.serverUrl !== serverUrl) });
}

/** Leaves the current server; it stays in the recent list. */
export function leaveCurrent() {
  const data = read();
  write({ current: null, list: data.list });
}

/** The clinic name to show, or the server's address when it has no name. */
export function displayName(connection) {
  if (!connection) return "";
  if (connection.name) return connection.name;
  try {
    return new URL(connection.link || connection.serverUrl).host;
  } catch {
    return connection.serverUrl;
  }
}
