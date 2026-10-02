// Service keys: saved straight into the server's encrypted store and never shown
// again. Only the last four characters are displayed.
import { button, withBusy } from "../../components/button.js";
import { confirmDialog } from "../../components/dialog.js";
import { chip, toast } from "../../components/feedback.js";
import { passwordField } from "../../components/fields.js";
import { checkKey, removeKey, saveKey } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { relative } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";

const KEYS = [
  { name: "elevenlabs_api_key", label: "ElevenLabs" },
  { name: "gemini_api_key", label: "Gemini" },
  { name: "deepseek_api_key", label: "DeepSeek" },
];

export function keysCard(secrets, { onChanged, elevenlabsModel }) {
  const rows = h("div", { class: "key-list" });

  function keyRow(key) {
    const saved = secrets[key.name];
    const status = saved ? chip(`Saved · ends in ${saved.last4}`, "green", "check") : chip("Not saved", "amber");
    const meta = saved ? h("p", { class: "field-hint", text: `Changed ${relative(saved.updated_at)}${saved.updated_by ? ` by ${saved.updated_by}` : ""}` }) : null;
    const result = h("p", { class: "key-result", attrs: { role: "status" }, hidden: true });
    const editor = h("div", { class: "key-editor", hidden: true });

    const field = passwordField(`${key.label} key`, { autocomplete: "off", placeholder: "Paste the key here" });
    const saveBtn = button("Save key", { variant: "primary", size: "small", icon: "key" });
    const cancelBtn = button("Cancel", { size: "small" });
    replace(editor, field.el, h("div", { class: "btn-row" }, cancelBtn, saveBtn));

    const editBtn = button(saved ? "Replace key" : "Add key", { size: "small", icon: saved ? "refresh" : "plus", variant: saved ? "" : "primary" });
    const checkBtn = button("Check key", { size: "small", icon: "checkCircle" });
    const removeBtn = button("Remove", { size: "small", variant: "quiet danger-text", icon: "trash" });
    checkBtn.hidden = !saved;
    removeBtn.hidden = !saved;

    editBtn.addEventListener("click", () => {
      editor.hidden = false;
      editBtn.hidden = true;
      field.input.focus();
    });
    cancelBtn.addEventListener("click", () => {
      editor.hidden = true;
      editBtn.hidden = false;
      field.input.value = "";
      field.setError("");
    });
    saveBtn.addEventListener("click", () =>
      withBusy(saveBtn, async () => {
        field.setError("");
        const value = field.value().trim();
        if (value.length < 8 || /\s/.test(value)) {
          field.setError("That key does not look right. Copy it again and paste it here.");
          return;
        }
        try {
          await saveKey(key.name, value);
          field.input.value = "";
          toast(`The ${key.label} key is saved.`);
          onChanged();
        } catch (error) {
          field.setError(messageOf(error));
        }
      })
    );
    checkBtn.addEventListener("click", () =>
      withBusy(checkBtn, async () => {
        result.hidden = true;
        try {
          const outcome = await checkKey(key.name, key.name === "elevenlabs_api_key" ? elevenlabsModel() : undefined);
          result.textContent = outcome.message;
          result.className = `key-result ${outcome.ok ? "ok" : "bad"}`;
        } catch (error) {
          result.textContent = messageOf(error);
          result.className = "key-result bad";
        }
        result.hidden = false;
      })
    );
    removeBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: `Remove the ${key.label} key?`,
        message: `Anything that uses ${key.label} will stop working until a new key is saved.`,
        confirmLabel: "Remove key",
        danger: true,
        onConfirm: () => removeKey(key.name),
      });
      if (ok) {
        toast(`The ${key.label} key has been removed.`);
        onChanged();
      }
    });

    return h(
      "div",
      { class: "key-row" },
      h("div", { class: "key-head" }, h("div", { class: "key-name" }, icon("key"), h("strong", { text: key.label })), status),
      meta,
      h("div", { class: "btn-row" }, editBtn, checkBtn, removeBtn),
      editor,
      result,
    );
  }

  replace(rows, KEYS.map(keyRow));
  return h(
    "section",
    { class: "glass-card card", attrs: { "aria-labelledby": "keys-title" } },
    h("div", { class: "card-head" }, h("div", {}, h("h2", { attrs: { id: "keys-title" } }, icon("key"), h("span", { text: "Service keys" })), h("p", { class: "card-sub", text: "Stored encrypted. Never shown again after saving." }))),
    rows,
  );
}
