// Google sign-in: guided set-up, applied to the project's sign-in service.
import { button, withBusy } from "../../components/button.js";
import { copyButton } from "../../components/cards.js";
import { confirmDialog } from "../../components/dialog.js";
import { banner, chip, loading, pageHead, toast } from "../../components/feedback.js";
import { passwordField, switchRow, textField } from "../../components/fields.js";
import { appAddress, config } from "../../config.js";
import { getGoogle, removeToken, saveGoogle, saveToken } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { icon } from "../../lib/icons.js";
import { store } from "../../lib/store.js";

function external(url, text) {
  return h("a", { href: url, text, attrs: { target: "_blank", rel: "noopener noreferrer" } });
}

function copyLine(value) {
  return h("div", { class: "code-copy" }, h("span", { text: value }), copyButton(() => value, { label: "Copy", copiedLabel: "Copied" }));
}

function tokenCard(state, reload) {
  const token = state.token ?? { saved: false };
  const field = passwordField("Supabase access token", { autocomplete: "off", placeholder: token.saved ? "Saved. Paste a new token to replace it." : "Paste the token here" });
  const save = button("Save token", { variant: "primary", size: "small", icon: "key" });
  const remove = button("Remove", { variant: "quiet danger-text", size: "small", icon: "trash" });
  remove.hidden = !token.saved;
  save.addEventListener("click", () =>
    withBusy(save, async () => {
      field.setError("");
      if (field.value().trim().length < 8) return field.setError("Paste the access token.");
      try {
        await saveToken(field.value().trim());
        toast("The access token is saved.");
        reload();
      } catch (error) {
        field.setError(messageOf(error));
      }
    })
  );
  remove.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Remove the access token?",
      message: "Google sign-in keeps its current settings, but they cannot be changed from here until a token is saved again.",
      confirmLabel: "Remove token",
      danger: true,
      onConfirm: () => removeToken(),
    });
    if (ok) {
      toast("The access token has been removed.");
      reload();
    }
  });
  return h(
    "section",
    { class: "glass-card card", attrs: { "aria-labelledby": "token-title" } },
    h("div", { class: "card-head" }, h("h2", { attrs: { id: "token-title" } }, icon("key"), h("span", { text: "Connection to Supabase" })), token.saved ? chip(`Saved · ends in ${token.last4}`, "green", "check") : chip("Not saved", "amber")),
    h(
      "div",
      { class: "stack" },
      h(
        "ol",
        { class: "steps-list" },
        h("li", {}, "Open ", external("https://supabase.com/dashboard/account/tokens", "Supabase access tokens"), " and create a new token."),
        h("li", { text: "Paste it below. It is stored encrypted and is only used to change this project's sign-in settings." }),
      ),
      field.el,
      h("div", { class: "btn-row" }, save, remove),
    ),
  );
}

function googleCard(state, reload) {
  const origin = new URL(appAddress()).origin;
  const clientId = textField("Client ID", { value: state.client_id ?? "", autocomplete: "off", attrs: { spellcheck: "false" } });
  const clientSecret = passwordField("Client secret", { autocomplete: "off", placeholder: state.client_id ? "Saved. Enter it again only if it changed." : "" });
  const enabled = switchRow("Let people sign in with Google", { description: "Only people already added in User settings can sign in.", checked: state.enabled });
  const save = button("Save", { variant: "primary", icon: "check" });
  const error = h("p", { class: "field-error", attrs: { role: "alert" }, hidden: true });
  save.addEventListener("click", () =>
    withBusy(save, async () => {
      error.hidden = true;
      clientId.setError("");
      if ((enabled.value() || clientId.value()) && !/\.apps\.googleusercontent\.com$/.test(clientId.value())) {
        clientId.setError("The Client ID ends with .apps.googleusercontent.com.");
        return;
      }
      try {
        await saveGoogle({ enabled: enabled.value(), client_id: clientId.value(), client_secret: clientSecret.value(), app_url: appAddress() });
        store.set({ publicConfig: { ...store.get().publicConfig, google_enabled: enabled.value() } });
        toast(enabled.value() ? "Google sign-in is on." : "Google sign-in is off.");
        reload();
      } catch (err) {
        error.textContent = messageOf(err);
        error.hidden = false;
      }
    })
  );

  return h(
    "section",
    { class: "glass-card card", attrs: { "aria-labelledby": "google-title" } },
    h("div", { class: "card-head" }, h("h2", { attrs: { id: "google-title" } }, icon("google"), h("span", { text: "Google" })), state.enabled ? chip("On", "green", "check") : chip("Off")),
    h(
      "div",
      { class: "stack" },
      h(
        "ol",
        { class: "steps-list" },
        h("li", {}, "In ", external("https://console.cloud.google.com/apis/credentials", "Google Cloud Console"), ", create an OAuth client ID of the type Web application."),
        h("li", {}, h("span", { text: "Under Authorised JavaScript origins, add:" }), copyLine(origin)),
        h("li", {}, h("span", { text: "Under Authorised redirect URIs, add:" }), copyLine(`${config.supabaseUrl}/auth/v1/callback`)),
        h("li", { text: "Copy the Client ID and Client secret into the fields below." }),
      ),
      h("div", { class: "form-grid" }, clientId.el, clientSecret.el),
      enabled.el,
      error,
    ),
    h("div", { class: "card-foot" }, save),
  );
}

export async function renderGoogle(container) {
  const body = h("div", { class: "stack" }, loading());
  replace(container, pageHead("Google sign-in"), body);
  async function load() {
    try {
      const state = await getGoogle();
      replace(
        body,
        state.token?.saved ? null : banner({ kind: "info", title: "First connect this page to Supabase", text: "Save a Supabase access token so the sign-in settings can be applied." }),
        tokenCard(state, load),
        googleCard(state, load),
      );
    } catch (error) {
      replace(body, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: load } }));
    }
  }
  await load();
}
