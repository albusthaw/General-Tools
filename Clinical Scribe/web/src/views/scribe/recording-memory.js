// What each recording tab remembers on this device: the recording it is following
// after Finish (for this browser tab only) and the template used last (for this
// person). Clinical Scribe and Voice Note each keep their own.
import { profile } from "../../lib/store.js";

// Keys used before Voice Note existed; they belong to Clinical Scribe.
const OLD_CURRENT = "cs-current-scribe";
const oldTemplateKey = () => `cs-last-template-${profile()?.id ?? ""}`;

const currentKey = (mode) => `cs-current-scribe-${mode}`;
const templateKey = (mode) => `cs-last-template-${mode}-${profile()?.id ?? ""}`;

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    // Not important.
  }
}

export function currentScribe(mode) {
  return read(sessionStorage, currentKey(mode)) ?? (mode === "scribe" ? read(sessionStorage, OLD_CURRENT) : null);
}

export function setCurrentScribe(mode, id) {
  write(sessionStorage, currentKey(mode), id);
  if (mode === "scribe") write(sessionStorage, OLD_CURRENT, null);
}

export function rememberTemplate(mode, id) {
  write(localStorage, templateKey(mode), id);
}

export function rememberedTemplate(mode) {
  return read(localStorage, templateKey(mode)) ?? (mode === "scribe" ? read(localStorage, oldTemplateKey()) : null);
}
