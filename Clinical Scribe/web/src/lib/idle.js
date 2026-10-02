// Signs the person out after a period without activity, never while a recording
// or upload is in progress. A warning appears one minute before.

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];

export function startIdleTimer({ minutes, isBusy, onWarn, onActive, onTimeout }) {
  if (!minutes || minutes <= 0) return () => {};
  const limit = minutes * 60_000;
  const warnAt = Math.max(limit - 60_000, limit / 2);
  let last = Date.now();
  let warned = false;

  const activity = () => {
    last = Date.now();
    if (warned) {
      warned = false;
      onActive?.();
    }
  };
  for (const name of EVENTS) window.addEventListener(name, activity, { passive: true });

  const timer = setInterval(async () => {
    if (await isBusy()) {
      last = Date.now();
      return;
    }
    const idle = Date.now() - last;
    if (idle >= limit) {
      stop();
      onTimeout();
    } else if (idle >= warnAt && !warned) {
      warned = true;
      onWarn(Math.ceil((limit - idle) / 1000));
    }
  }, 5000);

  function stop() {
    clearInterval(timer);
    for (const name of EVENTS) window.removeEventListener(name, activity);
  }
  return stop;
}
