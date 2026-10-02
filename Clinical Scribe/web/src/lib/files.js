// Saves a file the person asked for: a browser download on the website and in the
// iPhone web app, the system "Save to…" picker in the Android app. Resolves to
// "started" for a browser download, "saved" when the app wrote the file, and
// false when the person cancels.
import { appHooks } from "./platform/hooks.js";

export async function saveFile(blob, filename) {
  if (appHooks.saveFile) return appHooks.saveFile(blob, filename);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "started";
}
