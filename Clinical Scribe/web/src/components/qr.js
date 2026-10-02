// A QR code drawn as one SVG path. The pattern comes from the uqr encoder (MIT).
import { encode } from "uqr";
import { svg } from "../lib/dom.js";

export function qrCode(text, { size = 184, label = "QR code" } = {}) {
  const { data, size: count } = encode(text, { ecc: "M", border: 3 });
  let d = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    })
  );
  const el = svg(
    {
      filled: true,
      viewBox: `0 0 ${count} ${count}`,
      parts: [
        ["rect", { width: count, height: count, fill: "#ffffff" }],
        ["path", { d, fill: "#13233f" }],
      ],
    },
    { size, label, className: "qr-code" },
  );
  el.setAttribute("shape-rendering", "crispEdges");
  return el;
}
