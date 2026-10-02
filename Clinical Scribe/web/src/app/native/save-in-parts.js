// Saving a file through the Android app's "Save to…" screen, in parts, so long
// recordings never have to be held in memory twice. A file that does not finish is
// removed again. The Android side is passed in (files.js), so this part has no
// other needs and can be tested on its own.
import { toast } from "../../components/feedback.js";

// Bytes per part. A multiple of 3, so every part is complete base64 on its own.
export const PART = 3 * 256 * 1024;

async function base64Of(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** text/csv;charset=utf-8 → text/csv */
export function plainType(type) {
  const plain = String(type || "").split(";")[0].trim().toLowerCase();
  return /^[a-z]{1,30}\/[a-z0-9][a-z0-9.+-]{0,99}$/.test(plain) ? plain : "application/octet-stream";
}

/** saveFile(blob, filename) for one native bridge; resolves "saved", or false when cancelled or failed. */
export function makeSaver(bridge, { failed = () => toast("The file could not be saved. Please try again.", "bad", 6000) } = {}) {
  return async function saveFile(blob, filename) {
    let token = null;
    try {
      const start = await bridge.saveFileStart({ name: filename, mimeType: plainType(blob.type) });
      if (!start?.saved || typeof start.token !== "string") return false;
      token = start.token;
      for (let offset = 0; offset < blob.size; offset += PART) {
        await bridge.saveFileWrite({ token, data: await base64Of(blob.slice(offset, offset + PART)) });
      }
      await bridge.saveFileFinish({ token });
      return "saved";
    } catch {
      if (token) await bridge.saveFileCancel({ token }).catch(() => {});
      failed();
      return false;
    }
  };
}
