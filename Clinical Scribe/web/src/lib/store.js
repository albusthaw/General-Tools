// Small shared state: who is signed in and what they may do.

const state = {
  session: null,
  context: null, // result of get_my_context
  publicConfig: { google_enabled: false, server_version: null },
};

const listeners = new Set();

export const store = {
  get() {
    return state;
  },
  set(patch) {
    Object.assign(state, patch);
    for (const listener of listeners) listener(state);
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function profile() {
  return state.context?.profile ?? null;
}

export function isAdmin() {
  const p = profile();
  return p?.role === "admin" && p?.status === "active";
}
