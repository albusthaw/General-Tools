// Screens for when the app cannot be used: not connected to a server, account
// waiting for approval or suspended, or the server could not be reached.
import { button } from "../components/button.js";
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { brand } from "./login.js";

function screen(root, { iconName, title, text, actions = [] }) {
  replace(
    root,
    h(
      "main",
      { class: "login" },
      h(
        "section",
        { class: "glass-card login-card", attrs: { "aria-labelledby": "blocked-title" } },
        brand(),
        h("div", { class: "blocked-icon" }, icon(iconName)),
        h("h1", { class: "login-title", attrs: { id: "blocked-title" }, text: title }),
        h("p", { class: "login-text", text }),
        actions.length ? h("div", { class: "btn-row login-actions" }, actions) : null,
      ),
    ),
  );
}

export function renderNotConnected(root) {
  screen(root, {
    iconName: "alert",
    title: "Not connected yet",
    text: "This copy of Clinical Scribe has not been connected to its server. The person who set it up needs to finish the setup.",
  });
}

export function renderAccountBlocked(root, status, onSignOut) {
  const pending = status === "pending";
  screen(root, {
    iconName: pending ? "timer" : "lock",
    title: pending ? "Waiting for approval" : "Account suspended",
    text: pending
      ? "Your account has been created but an administrator needs to approve it before you can use Clinical Scribe."
      : "Your account has been suspended. Ask your administrator if you think this is a mistake.",
    actions: [button("Sign out", { icon: "logout", onClick: onSignOut })],
  });
}

export function renderServerProblem(root, message, onRetry, onSignOut) {
  screen(root, {
    iconName: "alert",
    title: "Something is not right",
    text: message,
    actions: [
      button("Try again", { icon: "refresh", variant: "primary", onClick: onRetry }),
      onSignOut ? button("Sign out", { icon: "logout", onClick: onSignOut }) : null,
    ].filter(Boolean),
  });
}
