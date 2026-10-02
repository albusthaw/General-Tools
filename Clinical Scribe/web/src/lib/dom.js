// Builds the page from DOM nodes. Text is always set as text, never parsed as
// HTML, so nothing a person types or an AI writes can run as code.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * h("button", { class: "btn", onClick: fn, attrs: { "aria-label": "Close" } }, "Text", child)
 * Children may be strings, numbers, nodes, arrays, or null/false (skipped).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el, props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class" || key === "className") {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : value;
    } else if (key === "text") {
      el.textContent = String(value);
    } else if (key === "attrs") {
      for (const [name, attr] of Object.entries(value)) {
        if (attr === undefined || attr === null || attr === false) continue;
        if (/^on/i.test(name)) continue;
        el.setAttribute(name, attr === true ? "" : String(attr));
      }
    } else if (key === "dataset") {
      for (const [name, data] of Object.entries(value)) el.dataset[name] = String(data);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in el) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

// Builds an SVG icon from trusted, built-in shape data (see icons.js).
export function svg(shapes, { size = 20, label = null, className = "" } = {}) {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", shapes.viewBox ?? "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  if (!shapes.filled) {
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", "1.75");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
  }
  if (className) el.setAttribute("class", className);
  if (label) {
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", label);
  } else {
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("focusable", "false");
  }
  for (const [tag, attrs] of shapes.parts) {
    const part = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) part.setAttribute(name, String(value));
    el.append(part);
  }
  return el;
}

// Runs fn when the element leaves the page (used to stop timers in views).
export function onRemove(el, fn) {
  const observer = new MutationObserver(() => {
    if (!el.isConnected) {
      observer.disconnect();
      fn();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function focusFirst(container) {
  const target = container.querySelector("h1, [autofocus], input, select, textarea, button");
  if (target) {
    if (!target.hasAttribute("tabindex") && /^H\d$/.test(target.tagName)) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
}
