// The Android back gesture: it closes an open sheet or menu first, then goes back
// a page, then returns to the Scribe tab. Only on the Scribe tab does it leave the
// app (a recording keeps running in the background).
import { closeOpenMenu } from "../components/menu.js";
import { currentRoute, navigate } from "../lib/router.js";

let pageBack = null;

/** The app frame registers how to go back from the open page. */
export function setPageBack(handler) {
  pageBack = handler;
  return () => {
    if (pageBack === handler) pageBack = null;
  };
}

/** Returns true when the gesture was used inside the app. */
export function handleBack() {
  const sheets = document.querySelectorAll("dialog[open]");
  if (sheets.length) {
    sheets[sheets.length - 1].dispatchEvent(new Event("cancel", { cancelable: true }));
    return true;
  }
  if (closeOpenMenu()) return true;
  if (pageBack?.()) return true;
  const route = currentRoute();
  if (route.name !== "scribe" && document.querySelector(".app-frame")) {
    navigate("/scribe");
    return true;
  }
  return false;
}
