// Saving files in the Android app: the system "Save to…" screen chooses the place,
// then the file is sent to Android in parts (save-in-parts.js).
import { ScribeNative } from "./plugin.js";
import { makeSaver } from "./save-in-parts.js";

export const saveFile = makeSaver(ScribeNative);
