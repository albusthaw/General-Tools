// Recordings that were interrupted on this device (closed tab, crash, flat
// battery), each offered on its own tab: process the saved audio, or delete it.
import { button, withBusy } from "../../components/button.js";
import { confirmDialog } from "../../components/dialog.js";
import { banner } from "../../components/feedback.js";
import { discardScribe } from "../../lib/api/scribes.js";
import { h } from "../../lib/dom.js";
import { timeOnly } from "../../lib/format.js";
import { modeOf } from "../../lib/modes.js";
import { store } from "../../lib/store.js";
import { dropScribe, requestFinish } from "../../lib/uploads/queue.js";
import { setCurrentScribe } from "./recording-memory.js";

function forget(scribeId) {
  store.set({ interrupted: (store.get().interrupted ?? []).filter((item) => item.scribeId !== scribeId) });
}

export function interruptedBanners(mode, onChange) {
  const type = modeOf(mode);
  const list = (store.get().interrupted ?? []).filter((item) => modeOf(item.mode).id === type.id);
  return list.map((item) => {
    const box = banner({
      kind: "warn",
      title: `A ${type.noun} was interrupted`,
      text: `The ${type.noun}${item.title ? ` "${item.title}"` : ""} started at ${timeOnly(item.startedAt)} was not finished. The audio that was saved can still be processed.`,
    });
    const actions = h("div", { class: "btn-row" });
    const keep = button("Process the saved audio", { size: "small", variant: "primary" });
    keep.addEventListener("click", () =>
      withBusy(keep, async () => {
        await requestFinish(item.scribeId, null);
        forget(item.scribeId);
        setCurrentScribe(mode, item.scribeId);
        onChange();
      })
    );
    const drop = button("Delete it", { size: "small", variant: "quiet danger-text" });
    drop.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: `Delete this ${type.noun}?`,
        message: "The saved audio will be deleted and cannot be recovered.",
        confirmLabel: `Delete ${type.noun}`,
        danger: true,
      });
      if (!ok) return;
      await dropScribe(item.scribeId);
      await discardScribe(item.scribeId).catch(() => {});
      forget(item.scribeId);
      onChange();
    });
    actions.append(keep, drop);
    box.querySelector(".banner-body").append(actions);
    return box;
  });
}
