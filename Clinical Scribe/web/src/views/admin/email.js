// Email (SMTP) settings: saved securely, not used by anything yet.
import { button, withBusy } from "../../components/button.js";
import { banner, chip, loading, pageHead, toast } from "../../components/feedback.js";
import { checkbox, fieldGroup, passwordField, segmented, textField } from "../../components/fields.js";
import { getEmail, saveEmail } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { relative } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";

const DEFAULT_PORTS = { ssl: "465", starttls: "587", none: "25" };

export async function renderEmail(container) {
  const body = h("div", { class: "stack" }, loading());
  replace(container, pageHead("Email (SMTP)"), body);

  async function load() {
    let state;
    try {
      state = await getEmail();
    } catch (error) {
      replace(body, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: load } }));
      return;
    }
    const host = textField("Server", { value: state.smtp_host, placeholder: "smtp.example.com", autocomplete: "off", attrs: { spellcheck: "false" } });
    const port = textField("Port", { type: "number", value: String(state.smtp_port ?? 587), inputMode: "numeric", attrs: { min: "1", max: "65535" } });
    let security = state.smtp_security ?? "starttls";
    const securityControl = segmented("Security", [
      { value: "ssl", label: "SSL/TLS" },
      { value: "starttls", label: "STARTTLS" },
      { value: "none", label: "None" },
    ], {
      value: security,
      onChange: (v) => {
        const previous = DEFAULT_PORTS[security];
        security = v;
        if (!port.value() || port.value() === previous) port.input.value = DEFAULT_PORTS[v];
      },
    });
    const username = textField("User name", { value: state.smtp_username, autocomplete: "off", attrs: { spellcheck: "false" } });
    const password = passwordField("Password", { autocomplete: "new-password", placeholder: state.password_saved ? "Saved. Enter a new one to replace it." : "" });
    const forget = checkbox("Remove the saved password");
    forget.el.hidden = !state.password_saved;
    const senderName = textField("Sender name", { value: state.smtp_sender_name, placeholder: "Clinic name", autocomplete: "off" });
    const senderEmail = textField("Sender email address", { type: "email", value: state.smtp_sender_email, placeholder: "noreply@example.com", autocomplete: "off" });
    const save = button("Save", { variant: "primary", icon: "check" });
    const error = h("p", { class: "field-error", attrs: { role: "alert" }, hidden: true });

    save.addEventListener("click", () =>
      withBusy(save, async () => {
        error.hidden = true;
        for (const field of [host, port, senderEmail]) field.setError("");
        const portValue = Number(port.value());
        if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) return port.setError("Enter a port between 1 and 65535.");
        if (senderEmail.value() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail.value())) return senderEmail.setError("Enter a valid email address.");
        try {
          await saveEmail({
            host: host.value(),
            port: portValue,
            security,
            username: username.value(),
            password: password.value(),
            remove_password: forget.value(),
            sender_name: senderName.value(),
            sender_email: senderEmail.value(),
          });
          toast("Email settings saved.");
          load();
        } catch (err) {
          error.textContent = messageOf(err);
          error.hidden = false;
        }
      })
    );

    replace(
      body,
      banner({ kind: "info", title: "Saved for later", text: "These settings are kept securely. Nothing is sent by email yet." }),
      h(
        "section",
        { class: "glass-card card", attrs: { "aria-labelledby": "smtp-title" } },
        h("div", { class: "card-head" }, h("h2", { attrs: { id: "smtp-title" } }, icon("mail"), h("span", { text: "Mail server" })), chip("Not in use yet", "amber")),
        h(
          "div",
          { class: "stack" },
          h("div", { class: "form-grid" }, host.el, port.el),
          fieldGroup("Security", securityControl.el),
          h("div", { class: "form-grid" }, username.el, password.el),
          forget.el,
          h("div", { class: "form-grid" }, senderName.el, senderEmail.el),
          state.smtp_updated_at ? h("p", { class: "field-hint", text: `Last saved ${relative(state.smtp_updated_at)}` }) : null,
          error,
        ),
        h("div", { class: "card-foot" }, save),
      ),
    );
  }
  await load();
}
