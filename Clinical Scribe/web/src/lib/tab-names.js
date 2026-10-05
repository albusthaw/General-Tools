// Tab bars with long names, such as "Clinical Scribe" on a narrow phone or with
// large text. When a name needs two lines, the page gets the class
// "tab-names-two-lines": every name then keeps room for two lines, so the icons
// stay in one row, and the bar grows a little. When a single word is wider than
// its tab (a very narrow screen or a wide font), the page also gets
// "tab-names-tight": the names become a little smaller and a long word may break,
// so no name runs into the next tab. Checked again when the bar's width changes
// and when the fonts arrive.
const TWO_LINES = "tab-names-two-lines";
const TIGHT = "tab-names-tight";

export function watchTabNames(bar, labelSelector) {
  const root = document.documentElement;
  let width = -1;
  let frame = 0;

  const check = () => {
    // The iPhone bar hides its names while it is small; keep the last answer.
    if (bar.classList.contains("is-min")) return;
    root.classList.remove(TWO_LINES, TIGHT);
    const labels = [...bar.querySelectorAll(labelSelector)];
    const tooWide = labels.some((label) => label.scrollWidth > label.clientWidth + 1);
    root.classList.toggle(TIGHT, tooWide);
    // Measured with the size the names end up with.
    const wraps = labels.some((label) => {
      const line = parseFloat(getComputedStyle(label).lineHeight);
      return line > 0 && label.getBoundingClientRect().height > line * 1.5;
    });
    root.classList.toggle(TWO_LINES, wraps);
  };
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(check);
  };

  // Only a change of width can change how the names wrap.
  const observer = new ResizeObserver(([entry]) => {
    const next = Math.round(entry.contentRect.width);
    if (next === width) return;
    width = next;
    later();
  });
  observer.observe(bar);
  document.fonts?.ready.then(later).catch(() => {});

  return {
    check: later,
    stop() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      root.classList.remove(TWO_LINES, TIGHT);
    },
  };
}
