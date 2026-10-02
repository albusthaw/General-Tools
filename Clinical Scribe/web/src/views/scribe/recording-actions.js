// Rename and delete for one recording. Used by the recording's page, and by the
// History list in the apps (swipe actions and the long-press menu).
import { confirmDialog, openDialog } from "../../components/dialog.js";
import { toast } from "../../components/feedback.js";
import { textField } from "../../components/fields.js";
import { deleteScribe, discardScribe, renameScribe } from "../../lib/api/scribes.js";
import { dropScribe } from "../../lib/uploads/queue.js";

export function renameRecording(scribe, onDone) {
  const field = textField("Label", { value: scribe.title, maxLength: 120, autocomplete: "off" });
  openDialog({
    title: "Rename recording",
    body: [field.el],
    actions: [
      { label: "Cancel" },
      {
        label: "Save",
        variant: "primary",
        onClick: async () => {
          await renameScribe(scribe.id, field.value());
          toast("The label is saved.");
          onDone?.();
        },
      },
    ],
  });
  field.input.focus();
}

export async function deleteRecording(scribe, onDone) {
  const unfinished = scribe.status === "recording";
  const ok = await confirmDialog({
    title: "Delete this recording?",
    message: unfinished
      ? "The saved audio will be deleted. This cannot be undone."
      : "The transcript and every note written from it will be deleted. This cannot be undone.",
    confirmLabel: "Delete recording",
    danger: true,
    onConfirm: async () => {
      if (unfinished) {
        await dropScribe(scribe.id);
        await discardScribe(scribe.id);
      } else {
        await deleteScribe(scribe.id);
      }
    },
  });
  if (ok) {
    toast("The recording has been deleted.");
    onDone?.();
  }
  return ok;
}
