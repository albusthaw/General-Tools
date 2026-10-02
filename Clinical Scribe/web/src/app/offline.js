// A thin bar under the top bar while the phone has no internet connection.
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

export function createOfflineBar() {
  const el = h(
    "div",
    { class: "app-offline", hidden: navigator.onLine !== false, attrs: { role: "status" } },
    icon("wifiOff"),
    h("span", { text: "No internet connection. Recordings are kept on this phone and sent when you are back online." }),
  );
  const update = () => {
    el.hidden = navigator.onLine !== false;
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return {
    el,
    destroy() {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    },
  };
}
