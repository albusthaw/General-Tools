// The signed-in person's own details and password.
import { openDialog } from "../components/dialog.js";
import { toast } from "../components/feedback.js";
import { passwordField, textField } from "../components/fields.js";
import { changePassword, updateMyName } from "../lib/api/session.js";
import { h } from "../lib/dom.js";
import { minutes } from "../lib/format.js";
import { profile, store } from "../lib/store.js";
import { refreshContext } from "./app.js";

const SERVICE_NAMES = { elevenlabs: "ElevenLabs", gemini: "Gemini" };

export function openAccountDialog() {
  const me = profile();
  const context = store.get().context;
  const name = textField("Your name", { value: me.full_name, autocomplete: "name", maxLength: 120 });
  const credit = context.credit;
  const creditText = credit.unlimited
    ? "Unlimited"
    : `${minutes(credit.seconds_left)} (${SERVICE_NAMES[credit.provider] ?? credit.provider})`;

  openDialog({
    title: "Your details",
    body: [
      name.el,
      h(
        "dl",
        { class: "kv" },
        h("dt", { text: "Email address" }),
        h("dd", { text: me.email }),
        h("dt", { text: "Role" }),
        h("dd", { text: me.role === "admin" ? "Admin" : "User" }),
        h("dt", { text: "Transcription minutes" }),
        h("dd", { text: creditText }),
      ),
    ],
    actions: [
      { label: "Cancel" },
      {
        label: "Save",
        variant: "primary",
        onClick: async () => {
          const value = name.value();
          if (!value) {
            name.setError("Enter your name.");
            return false;
          }
          await updateMyName(value);
          await refreshContext();
          toast("Your details are saved.");
          return true;
        },
      },
    ],
  });
}

export function openPasswordDialog() {
  const me = profile();
  const current = passwordField("Current password", { autocomplete: "current-password" });
  const next = passwordField("New password", { autocomplete: "new-password", hint: "At least 10 characters, with letters and numbers." });
  const again = passwordField("New password again", { autocomplete: "new-password" });

  openDialog({
    title: "Change password",
    body: [current.el, next.el, again.el],
    actions: [
      { label: "Cancel" },
      {
        label: "Change password",
        variant: "primary",
        onClick: async () => {
          for (const field of [current, next, again]) field.setError("");
          if (!current.value()) {
            current.setError("Enter your current password.");
            return false;
          }
          const value = next.value();
          if (value.length < 10 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
            next.setError("Use at least 10 characters, with letters and numbers.");
            return false;
          }
          if (value !== again.value()) {
            again.setError("The two new passwords do not match.");
            return false;
          }
          await changePassword(me.email, current.value(), value);
          toast("Your password has been changed.");
          return true;
        },
      },
    ],
  });
}
