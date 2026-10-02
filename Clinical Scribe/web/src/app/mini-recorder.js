// The small recorder that follows you to other tabs while a recording runs: red
// dot, time, and Pause or Resume. Tap it to go back to the recorder.
import { h, replace } from "../lib/dom.js";
import { clock } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { elapsedSeconds, onRecorderChange, pause, resume } from "../lib/recorder/recorder.js";
import { href } from "../lib/router.js";

export function createMiniRecorder({ onVisibleChange }) {
  const label = h("span", { class: "mini-label" });
  const time = h("span", { class: "mini-time tabular" });
  const toggle = h("button", { type: "button", class: "mini-toggle" });
  const el = h(
    "div",
    { class: "app-mini", hidden: true, attrs: { role: "region", "aria-label": "Recording in progress" } },
    h("a", { class: "mini-open", href: href("/scribe") }, h("span", { class: "mini-dot", attrs: { "aria-hidden": "true" } }), label, time),
    toggle,
  );

  let routeName = "";
  let phase = "idle";
  let timer = null;

  toggle.addEventListener("click", () => (phase === "paused" ? resume() : pause()));

  function draw() {
    const busy = phase === "recording" || phase === "paused";
    const show = busy && routeName !== "scribe";
    if (el.hidden === show) {
      el.hidden = !show;
      onVisibleChange?.(show);
    }
    clearInterval(timer);
    if (!show) return;
    const paused = phase === "paused";
    el.classList.toggle("is-paused", paused);
    label.textContent = paused ? "Paused" : "Recording";
    const tick = () => (time.textContent = clock(elapsedSeconds()));
    tick();
    if (!paused) timer = setInterval(tick, 1000);
    replace(toggle, icon(paused ? "play" : "pause"));
    toggle.setAttribute("aria-label", paused ? "Resume" : "Pause");
  }

  const stop = onRecorderChange((state) => {
    phase = state.phase;
    draw();
  });

  return {
    el,
    update(route) {
      routeName = route.name;
      draw();
    },
    destroy() {
      stop();
      clearInterval(timer);
    },
  };
}
