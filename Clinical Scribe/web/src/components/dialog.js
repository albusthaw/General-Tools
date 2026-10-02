// Dialogs built on the native <dialog> element (focus stays inside, Escape closes).
// On phones they appear as bottom sheets.
import { append, h } from "../lib/dom.js";
import { messageOf } from "../lib/errors.js";
import { button, iconButton, withBusy } from "./button.js";
import { textField } from "./fields.js";

/**
 * openDialog({ title, body, actions: [{ label, variant, icon, onClick }], wide, onClose })
 * An action's onClick may return false to keep the dialog open, or throw an error
 * whose message is shown inside the dialog.
 */
export function openDialog({ title, body = [], actions = [], wide = false, onClose, dismissible = true }) {
  const errorBox = h("p", { class: "field-error", attrs: { role: "alert" }, hidden: true });
  const bodyEl = h("div", { class: "dialog-body" });
  append(bodyEl, [body, errorBox]);
  const foot = h("div", { class: "dialog-foot" });
  const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`;
  const dialog = h(
    "dialog",
    { class: ["dialog", wide && "wide"], attrs: { "aria-labelledby": titleId } },
    h(
      "div",
      { class: "dialog-head" },
      h("h2", { attrs: { id: titleId }, text: title }),
      dismissible ? iconButton("close", "Close", { onClick: () => close() }) : null,
    ),
    bodyEl,
    actions.length ? foot : null,
  );

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    onClose?.(result);
  }

  function showError(message) {
    errorBox.textContent = message ?? "";
    errorBox.hidden = !message;
  }

  for (const action of actions) {
    const btn = button(action.label, { variant: action.variant ?? "", icon: action.icon });
    btn.addEventListener("click", () =>
      withBusy(btn, async () => {
        showError("");
        try {
          const keep = action.onClick ? await action.onClick({ close, showError, dialog }) : undefined;
          if (keep !== false) close(action.result ?? true);
        } catch (error) {
          showError(messageOf(error));
        }
      })
    );
    foot.append(btn);
  }

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (dismissible) close(false);
  });
  dialog.addEventListener("click", (event) => {
    // A click on the dimmed backdrop closes the dialog.
    if (dismissible && event.target === dialog) close(false);
  });

  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close, showError, body: bodyEl };
}

/**
 * Asks for confirmation. With `typeToConfirm`, the person must type that text.
 * Resolves true when confirmed.
 */
export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false, typeToConfirm = null, details = null, onConfirm }) {
  return new Promise((resolve) => {
    const typed = typeToConfirm ? textField(`Type ${typeToConfirm} to confirm`, { autocomplete: "off" }) : null;
    openDialog({
      title,
      body: [h("p", { text: message }), details, typed?.el],
      actions: [
        { label: "Cancel", variant: "", result: false, onClick: () => resolve(false) },
        {
          label: confirmLabel,
          variant: danger ? "danger" : "primary",
          onClick: async () => {
            if (typed && typed.value().toLowerCase() !== typeToConfirm.toLowerCase()) {
              typed.setError("That does not match. Type it exactly as shown.");
              return false;
            }
            if (onConfirm) await onConfirm();
            resolve(true);
            return true;
          },
        },
      ],
      onClose: (result) => {
        if (!result) resolve(false);
      },
    });
  });
}
