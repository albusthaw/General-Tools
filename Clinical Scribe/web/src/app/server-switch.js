// Change server: leaves the current clinic on this phone and goes back to Connect.
// Not while audio is still being saved, so no recording is lost.
import { openDialog } from "../components/dialog.js";
import { currentConnection, displayName, leaveCurrent } from "../lib/connection/store.js";
import { h } from "../lib/dom.js";
import { isRecording } from "../lib/recorder/recorder.js";
import { store } from "../lib/store.js";
import * as queue from "../lib/uploads/queue.js";
import { signOutNow } from "../views/app.js";

const CHOOSING_KEY = "cs-choose-server";

/** True once after Change server, so Connect shows the form and the recent servers. */
export function takeServerChoice() {
  try {
    const choosing = sessionStorage.getItem(CHOOSING_KEY) === "1";
    sessionStorage.removeItem(CHOOSING_KEY);
    return choosing;
  } catch {
    return false;
  }
}

export async function changeServer() {
  if (isRecording() || (await queue.hasPending())) {
    openDialog({
      title: "Audio is still being saved",
      body: [h("p", { text: "Wait until the recording is saved, then change the server." })],
      actions: [{ label: "OK", variant: "primary" }],
    });
    return;
  }
  const name = displayName(currentConnection());
  const signedIn = Boolean(store.get().session);
  openDialog({
    title: "Change server?",
    body: [h("p", { text: signedIn ? `You will be signed out of ${name} on this phone.` : `Clinical Scribe will stop using ${name} on this phone.` })],
    actions: [
      { label: "Cancel" },
      {
        label: "Change server",
        variant: "primary",
        onClick: async () => {
          if (signedIn) await signOutNow();
          leaveCurrent();
          try {
            sessionStorage.setItem(CHOOSING_KEY, "1");
          } catch {
            // Connect then suggests this site's server again, with another link one tap away.
          }
          window.location.reload();
        },
      },
    ],
  });
}
