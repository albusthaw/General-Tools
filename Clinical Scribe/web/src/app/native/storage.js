// Sign-in storage for the Android app. Supabase keeps its sign-in here instead of
// in the web page's storage; the Android code encrypts every value with a key held
// in the phone's secure hardware (SecureStore.java).
import { ScribeNative } from "./plugin.js";

export const authStorage = {
  async getItem(key) {
    const result = await ScribeNative.secureGet({ key });
    return typeof result?.value === "string" ? result.value : null;
  },
  async setItem(key, value) {
    await ScribeNative.secureSet({ key, value: String(value) });
  },
  async removeItem(key) {
    await ScribeNative.secureRemove({ key });
  },
};
