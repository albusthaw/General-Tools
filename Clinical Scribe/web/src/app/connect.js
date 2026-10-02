// Connect: the first screen of the apps. It asks for the server link, finds the
// server, shows which clinic it is, and connects after one tap. Recent servers can
// be chosen again with one tap.
import { button, iconButton, withBusy } from "../components/button.js";
import { loading } from "../components/feedback.js";
import { textField } from "../components/fields.js";
import { config } from "../config.js";
import { lookupServer } from "../lib/connection/lookup.js";
import { displayName, forgetConnection, recentConnections, rememberConnection } from "../lib/connection/store.js";
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { brand } from "../views/login.js";

const MESSAGES = {
  empty: "Enter the server link.",
  invalid: "That link does not look right. Check it and try again.",
  not_https: "Links must start with https://.",
  not_found: "No Clinical Scribe server was found at that link.",
  offline: "The server cannot be reached. Check your internet connection and try again.",
  server_old: "This server needs an update before the apps can connect. Ask your administrator.",
  secret_key: "This server is not set up safely for the apps. Ask your administrator to run the update.",
};

export function connectMessage(code) {
  return MESSAGES[code] ?? MESSAGES.not_found;
}

function hostOf(connection) {
  try {
    return new URL(connection.link || connection.serverUrl).host;
  } catch {
    return "";
  }
}

/**
 * renderConnect(root, { prefill, quietPrefill, readClipboard, onConnected })
 * prefill: a server link to look up at once (the clinic's own site, or a link
 * that opened the app). quietPrefill: show no error when that lookup fails.
 */
export function renderConnect(root, { prefill = "", quietPrefill = false, readClipboard = null, onConnected }) {
  const card = h("section", { class: "glass-card login-card connect-card", attrs: { "aria-labelledby": "connect-title" } });
  replace(root, h("main", { class: "login app-connect" }, card, h("p", { class: "login-foot", text: `Version ${config.appVersion}` })));

  function finish(connection) {
    onConnected(rememberConnection(connection));
  }

  function showConfirm(connection) {
    const yes = button("Connect", { variant: "primary", size: "large", block: true, icon: "check" });
    yes.addEventListener("click", () => finish(connection));
    replace(
      card,
      brand(),
      h("h1", { class: "login-title", attrs: { id: "connect-title" }, text: "Connect" }),
      h(
        "div",
        { class: "connect-confirm", attrs: { role: "group", "aria-label": "Server found" } },
        h("span", { class: "connect-badge", attrs: { "aria-hidden": "true" } }, icon("globe", { size: 28 })),
        h("p", { class: "connect-question", text: "Connect to" }),
        h("p", { class: "connect-name", text: `${displayName(connection)}?` }),
        connection.name ? h("p", { class: "connect-address", text: hostOf(connection) }) : null,
      ),
      yes,
      button("Use another link", { variant: "quiet", block: true, onClick: () => showForm(connection.link) }),
    );
    yes.focus();
  }

  function showForm(value = "", error = "") {
    const field = textField("Server link", {
      type: "url",
      inputMode: "url",
      autocomplete: "url",
      placeholder: "https://",
      hint: "Ask your administrator for this link.",
      attrs: { autocapitalize: "none", spellcheck: "false", enterkeyhint: "go" },
    });
    field.input.value = value;
    const paste = iconButton("paste", "Paste", {
      onClick: async () => {
        try {
          const text = readClipboard ? await readClipboard() : await navigator.clipboard.readText();
          if (text) field.input.value = text.trim();
        } catch {
          // Pasting is not allowed here; the person can type the link.
        }
        field.input.focus();
      },
    });
    const box = h("div", { class: "input-wrap" });
    field.input.replaceWith(box);
    box.append(field.input, paste);
    if (error) field.setError(error);

    const submit = button("Connect", { variant: "primary", size: "large", type: "submit", block: true });
    const form = h(
      "form",
      {
        class: "login-form",
        attrs: { novalidate: true },
        onSubmit: (event) => {
          event.preventDefault();
          field.setError("");
          withBusy(submit, async () => {
            const result = await lookupServer(field.input.value);
            if (result.connection) showConfirm(result.connection);
            else field.setError(connectMessage(result.error));
          });
        },
      },
      field.el,
      submit,
    );

    const recent = recentConnections();
    replace(
      card,
      brand(),
      h("h1", { class: "login-title", attrs: { id: "connect-title" }, text: "Connect" }),
      form,
      recent.length
        ? h(
          "section",
          { class: "recent-servers", attrs: { "aria-labelledby": "recent-title" } },
          h("h2", { class: "recent-title", attrs: { id: "recent-title" }, text: "Recent servers" }),
          h(
            "ul",
            { class: "recent-list" },
            recent.map((item) =>
              h(
                "li",
                { class: "recent-item" },
                h(
                  "button",
                  { type: "button", class: "recent-open", onClick: () => finish(item) },
                  icon("globe"),
                  h("span", { class: "recent-text" }, h("span", { class: "recent-name", text: displayName(item) }), h("span", { class: "recent-host", text: hostOf(item) })),
                ),
                iconButton("close", `Remove ${displayName(item)}`, {
                  onClick: () => {
                    forgetConnection(item.serverUrl);
                    showForm(field.input.value);
                  },
                }),
              )
            ),
          ),
        )
        : null,
    );
    if (!value) field.input.focus();
  }

  if (prefill) {
    replace(card, brand(), h("h1", { class: "login-title", attrs: { id: "connect-title" }, text: "Connect" }), loading("Looking for the server…"));
    lookupServer(prefill).then((result) => {
      if (result.connection) showConfirm(result.connection);
      else showForm(quietPrefill ? "" : prefill, quietPrefill ? "" : connectMessage(result.error));
    });
  } else {
    showForm();
  }
}
