// Dialogs for User settings: add a person, change a password, transcription minutes.
import { button } from "../../components/button.js";
import { openDialog } from "../../components/dialog.js";
import { toast } from "../../components/feedback.js";
import { fieldGroup, passwordField, segmented, switchRow, textField } from "../../components/fields.js";
import { adjustCredit, createUser, creditHistory, setPassword, setUnlimited } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { dateTime, minutes } from "../../lib/format.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

// A random password with letters and numbers that is easy to read out.
export function generatePassword(length = 14) {
  const values = new Uint32Array(length);
  for (;;) {
    crypto.getRandomValues(values);
    const out = Array.from(values, (v) => ALPHABET[v % ALPHABET.length]).join("");
    if (/[A-Za-z]/.test(out) && /[0-9]/.test(out)) return out;
  }
}

function passwordWithGenerator(label, autocomplete = "new-password") {
  const field = passwordField(label, { autocomplete, hint: "At least 10 characters, with letters and numbers." });
  const generate = button("Suggest a password", { size: "small", variant: "quiet", icon: "key" });
  generate.addEventListener("click", () => {
    field.input.value = generatePassword();
    field.input.type = "text";
    field.input.focus();
    field.input.select();
  });
  field.el.append(h("div", { class: "btn-row" }, generate));
  return field;
}

function checkPassword(field) {
  const value = field.value();
  if (value.length < 10 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    field.setError("Use at least 10 characters, with letters and numbers.");
    return false;
  }
  return true;
}

function minutesInput(label, value = 0) {
  return textField(label, { type: "number", value: String(value), inputMode: "numeric", attrs: { min: "0", step: "1" } });
}

export function openAddPerson(onDone) {
  const name = textField("Full name", { autocomplete: "off", maxLength: 120 });
  const email = textField("Email address", { type: "email", autocomplete: "off", inputMode: "email" });
  const password = passwordWithGenerator("Starting password");
  let role = "user";
  const roleControl = segmented("Role", [{ value: "user", label: "User" }, { value: "admin", label: "Admin" }], { value: "user", onChange: (v) => (role = v) });
  const elevenlabs = minutesInput("ElevenLabs minutes", 60);
  const gemini = minutesInput("Gemini minutes", 60);
  const unlimited = switchRow("Unlimited minutes", { description: "Never limit this person's transcription time." });
  const minuteBox = h("div", { class: "form-grid" }, elevenlabs.el, gemini.el);
  unlimited.input.addEventListener("change", () => (minuteBox.hidden = unlimited.value()));

  openDialog({
    title: "Add person",
    body: [
      h("div", { class: "form-grid" }, name.el, email.el),
      password.el,
      fieldGroup("Role", roleControl.el, "Admins can manage people, settings and the audit log."),
      h("h3", { class: "subhead", text: "Transcription minutes" }),
      unlimited.el,
      minuteBox,
      h("p", { class: "field-hint", text: "Give the starting password to the person in a safe way. They can change it after signing in." }),
    ],
    actions: [
      { label: "Cancel" },
      {
        label: "Add person",
        variant: "primary",
        icon: "plus",
        onClick: async () => {
          for (const field of [name, email, password, elevenlabs, gemini]) field.setError("");
          let ok = true;
          if (!name.value()) {
            name.setError("Enter the person's name.");
            ok = false;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value())) {
            email.setError("Enter a valid email address.");
            ok = false;
          }
          if (!checkPassword(password)) ok = false;
          const el = Number(elevenlabs.value() || 0);
          const ge = Number(gemini.value() || 0);
          if (!Number.isFinite(el) || el < 0) {
            elevenlabs.setError("Enter 0 or more.");
            ok = false;
          }
          if (!Number.isFinite(ge) || ge < 0) {
            gemini.setError("Enter 0 or more.");
            ok = false;
          }
          if (!ok) return false;
          await createUser({
            email: email.value(),
            full_name: name.value(),
            password: password.value(),
            role,
            elevenlabs_minutes: el,
            gemini_minutes: ge,
            unlimited: unlimited.value(),
          });
          toast(`${name.value()} has been added.`);
          onDone?.();
          return true;
        },
      },
    ],
  });
  name.input.focus();
}

export function openChangePassword(person, onDone) {
  const password = passwordWithGenerator("New password");
  openDialog({
    title: "Change password",
    body: [
      h("p", { text: `Set a new password for ${person.full_name || person.email}.` }),
      password.el,
      h("p", { class: "field-hint", text: "Give the new password to the person in a safe way." }),
    ],
    actions: [
      { label: "Cancel" },
      {
        label: "Change password",
        variant: "primary",
        onClick: async () => {
          password.setError("");
          if (!checkPassword(password)) return false;
          await setPassword(person.id, password.value());
          toast("The password has been changed.");
          onDone?.();
          return true;
        },
      },
    ],
  });
}

const KIND_LABELS = {
  grant: "Added",
  set: "Set",
  usage: "Used",
  refund: "Returned",
  correction: "Adjusted",
  unlimited_on: "Unlimited switched on",
  unlimited_off: "Unlimited switched off",
};
const SERVICE = { elevenlabs: "ElevenLabs", gemini: "Gemini" };

export function openMinutes(person, onDone) {
  let provider = "elevenlabs";
  let mode = "add";
  const balances = h("dl", { class: "kv" });
  const drawBalances = (p) =>
    replace(
      balances,
      h("dt", { text: "ElevenLabs" }),
      h("dd", { class: "tabular", text: p.credit_unlimited ? "Unlimited" : minutes(p.credit_seconds_elevenlabs) }),
      h("dt", { text: "Gemini" }),
      h("dd", { class: "tabular", text: p.credit_unlimited ? "Unlimited" : minutes(p.credit_seconds_gemini) }),
    );
  drawBalances(person);

  const service = segmented("Service", [{ value: "elevenlabs", label: "ElevenLabs" }, { value: "gemini", label: "Gemini" }], { value: provider, onChange: (v) => (provider = v) });
  const how = segmented("Change", [{ value: "add", label: "Add minutes" }, { value: "set", label: "Set balance" }], { value: mode, onChange: (v) => (mode = v) });
  const amount = textField("Minutes", { type: "number", value: "60", inputMode: "numeric", hint: "To take minutes away, add a negative number.", attrs: { step: "1" } });
  const note = textField("Note (optional)", { maxLength: 200, autocomplete: "off" });
  const unlimited = switchRow("Unlimited minutes", { description: "Never limit this person's transcription time.", checked: person.credit_unlimited });
  const historyList = h("div", { class: "ledger" });

  async function loadHistory() {
    try {
      const rows = await creditHistory(person.id, 15);
      replace(
        historyList,
        rows.length
          ? rows.map((row) =>
            h(
              "div",
              { class: "ledger-row" },
              h("span", { class: "ledger-kind", text: `${KIND_LABELS[row.kind] ?? row.kind} · ${SERVICE[row.provider] ?? row.provider}` }),
              h("span", { class: "ledger-change tabular", text: row.kind.startsWith("unlimited") ? "" : `${row.change_seconds > 0 ? "+" : ""}${Math.round(row.change_seconds / 6) / 10} min` }),
              h("span", { class: "ledger-when", text: `${dateTime(row.created_at)}${row.actor_name ? ` · ${row.actor_name}` : ""}${row.note ? ` · ${row.note}` : ""}` }),
            )
          )
          : h("p", { class: "muted small", text: "No changes yet." }),
      );
    } catch {
      replace(historyList, h("p", { class: "muted small", text: "The history could not be loaded." }));
    }
  }
  loadHistory();

  unlimited.input.addEventListener("change", async () => {
    try {
      await setUnlimited(person.id, unlimited.value());
      person = { ...person, credit_unlimited: unlimited.value() };
      drawBalances(person);
      toast(unlimited.value() ? "Unlimited minutes switched on." : "Unlimited minutes switched off.");
      loadHistory();
      onDone?.();
    } catch {
      unlimited.input.checked = !unlimited.value();
      toast("That could not be changed. Please try again.", "bad");
    }
  });

  openDialog({
    title: `Transcription minutes: ${person.full_name || person.email}`,
    body: [
      balances,
      unlimited.el,
      h("div", { class: "form-grid" }, fieldGroup("Service", service.el), fieldGroup("Change", how.el)),
      h("div", { class: "form-grid" }, amount.el, note.el),
      h("h3", { class: "subhead", text: "Recent changes" }),
      historyList,
    ],
    actions: [
      { label: "Close" },
      {
        label: "Save minutes",
        variant: "primary",
        onClick: async () => {
          amount.setError("");
          const value = Number(amount.value());
          if (!Number.isFinite(value) || (mode === "set" && value < 0) || (mode === "add" && value === 0)) {
            amount.setError(mode === "set" ? "Enter 0 or more." : "Enter a number other than 0.");
            return false;
          }
          const result = await adjustCredit({ userId: person.id, provider, mode, minutes: value, note: note.value() });
          const key = provider === "elevenlabs" ? "credit_seconds_elevenlabs" : "credit_seconds_gemini";
          person = { ...person, [key]: result.balance_seconds ?? person[key] };
          drawBalances(person);
          loadHistory();
          toast(`${SERVICE[provider]} minutes saved.`);
          onDone?.();
          return false;
        },
      },
    ],
  });
}
