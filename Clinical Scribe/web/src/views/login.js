// Sign-in page.
import { button, withBusy } from "../components/button.js";
import { passwordField, textField } from "../components/fields.js";
import { config, isApp } from "../config.js";
import { signIn, signInWithGoogle } from "../lib/api/session.js";
import { h, replace } from "../lib/dom.js";
import { messageOf } from "../lib/errors.js";
import { icon } from "../lib/icons.js";
import { store } from "../lib/store.js";
import { getAppOffer } from "./get-app.js";

export function brand() {
  return h(
    "div",
    { class: "brand login-brand" },
    h("span", { class: "brand-mark" }, icon("waveform")),
    h("span", { class: "brand-name", text: "Clinical Scribe" }),
  );
}

const REASONS = {
  idle: "You were signed out after a period without activity.",
  signed_out: "You have signed out.",
};

// `above` is an optional element shown between the brand and the title (the apps
// show the connected clinic there).
export function renderLogin(root, { above = null } = {}) {
  const reason = sessionStorage.getItem("cs-signout-reason");
  sessionStorage.removeItem("cs-signout-reason");

  const email = textField("Email address", { type: "email", autocomplete: "username", inputMode: "email", attrs: { autocapitalize: "none", spellcheck: "false" } });
  const password = passwordField("Password", { autocomplete: "current-password" });
  const errorBox = h("p", { class: "field-error login-error", attrs: { role: "alert" }, hidden: true });
  const submit = button("Sign in", { variant: "primary", size: "large", type: "submit", block: true });

  const showError = (message) => {
    errorBox.textContent = message ?? "";
    errorBox.hidden = !message;
  };

  const form = h(
    "form",
    {
      class: "login-form",
      attrs: { novalidate: true },
      onSubmit: (event) => {
        event.preventDefault();
        showError("");
        email.setError("");
        password.setError("");
        if (!email.value()) return email.setError("Enter your email address.");
        if (!password.value()) return password.setError("Enter your password.");
        withBusy(submit, async () => {
          try {
            await signIn(email.value(), password.value());
          } catch (error) {
            showError(messageOf(error));
          }
        });
      },
    },
    email.el,
    password.el,
    errorBox,
    submit,
  );

  const googleEnabled = Boolean(store.get().publicConfig?.google_enabled);
  const google = googleEnabled
    ? h(
      "div",
      { class: "login-alt" },
      h("div", { class: "or-line" }, h("span", { text: "or" })),
      (() => {
        const btn = h("button", { type: "button", class: "btn block large google-btn" }, icon("google"), h("span", { text: "Continue with Google" }));
        btn.addEventListener("click", () =>
          withBusy(btn, async () => {
            try {
              await signInWithGoogle();
            } catch (error) {
              showError(messageOf(error));
            }
          })
        );
        return btn;
      })(),
    )
    : null;

  replace(
    root,
    h(
      "main",
      { class: "login" },
      h(
        "section",
        { class: "glass-card login-card", attrs: { "aria-labelledby": "login-title" } },
        brand(),
        above,
        h("h1", { class: "login-title", attrs: { id: "login-title" }, text: "Sign in" }),
        reason && REASONS[reason] ? h("p", { class: "login-note", attrs: { role: "status" }, text: REASONS[reason] }) : null,
        form,
        google,
        h("p", { class: "login-help", text: "Forgot your password? Ask your administrator." }),
      ),
      isApp ? null : getAppOffer(),
      h("p", { class: "login-foot", text: `Version ${config.appVersion}` }),
    ),
  );
  email.input.focus();
}
