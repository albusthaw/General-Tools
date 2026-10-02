// The More tab: the person's details and password, the server the app is
// connected to, the admin settings for admins, the app version and Sign out.
import { chip, pageHead } from "../components/feedback.js";
import { config } from "../config.js";
import { currentConnection, displayName } from "../lib/connection/store.js";
import { h, replace } from "../lib/dom.js";
import { initials } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { href } from "../lib/router.js";
import { isAdmin, profile } from "../lib/store.js";
import { openAccountDialog, openPasswordDialog } from "../views/account.js";
import { requestSignOut } from "../views/app.js";
import { ADMIN_LINKS } from "../views/shell.js";
import { changeServer } from "./server-switch.js";
import { newerApp, openApp } from "./update.js";

function row({ label, iconName, detail = "", href: target = null, onClick = null, kind = "" }) {
  const inner = [
    h("span", { class: "more-icon" }, icon(iconName)),
    h("span", { class: "more-text" }, h("span", { class: "more-label", text: label }), detail ? h("span", { class: "more-detail", text: detail }) : null),
    target || kind === "" ? icon("chevronRight", { className: "chev" }) : null,
  ];
  return target
    ? h("a", { class: ["more-row", kind], href: target }, inner)
    : h("button", { type: "button", class: ["more-row", kind], onClick }, inner);
}

function group(title, rows) {
  const id = `more-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return h(
    "section",
    { class: "more-group", attrs: { "aria-labelledby": id } },
    h("h2", { class: "more-group-title", attrs: { id }, text: title }),
    h("div", { class: "glass-card more-list" }, rows),
  );
}

export function renderMore(container) {
  const me = profile();
  const admin = isAdmin();
  const connection = currentConnection();
  const appGroup = group("App", [row({ label: "Version", iconName: "info", detail: config.appVersion, kind: "info" })]);
  newerApp().then((app) => {
    if (app && appGroup.isConnected) {
      appGroup.querySelector(".more-list").append(row({ label: `Get version ${app.version}`, iconName: "download", onClick: () => openApp(app), kind: "accent" }));
    }
  });

  replace(
    container,
    pageHead("More"),
    h(
      "section",
      { class: "glass-card more-profile", attrs: { "aria-label": "Your account" } },
      h("span", { class: "avatar large", text: initials(me.full_name, me.email) }),
      h(
        "span",
        { class: "more-person" },
        h("span", { class: "more-name", text: me.full_name || me.email }),
        h("span", { class: "more-email", text: me.email }),
      ),
      chip(admin ? "Admin" : "User", admin ? "blue" : ""),
    ),
    group("Account", [
      row({ label: "Your details", iconName: "user", onClick: openAccountDialog }),
      row({ label: "Change password", iconName: "lock", onClick: openPasswordDialog }),
    ]),
    group("Server", [
      row({ label: "Connected to", iconName: "globe", detail: displayName(connection), kind: "info" }),
      row({ label: "Change server", iconName: "link", onClick: changeServer, kind: "accent" }),
    ]),
    admin ? group("Admin settings", ADMIN_LINKS.map((link) => row({ label: link.label, iconName: link.icon, href: href(link.path) }))) : null,
    appGroup,
    h("div", { class: "more-list glass-card more-signout" }, row({ label: "Sign out", iconName: "logout", onClick: () => requestSignOut(), kind: "danger" })),
  );
}
