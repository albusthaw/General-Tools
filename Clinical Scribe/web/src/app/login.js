// Sign-in inside the apps: the website's sign-in screen, with the connected
// clinic shown above it and a way to change the server.
import { displayName } from "../lib/connection/store.js";
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { renderLogin } from "../views/login.js";
import { changeServer } from "./server-switch.js";

function clinicChip(connection) {
  return h(
    "div",
    { class: "clinic-chip" },
    icon("globe"),
    h("span", { class: "clinic-name", text: displayName(connection) }),
    h("button", { type: "button", class: "link-button", text: "Change", attrs: { "aria-label": "Change server" }, onClick: changeServer }),
  );
}

export function appLogin(connection) {
  return (root) => renderLogin(root, { above: clinicChip(connection) });
}
