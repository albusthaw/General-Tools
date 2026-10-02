// CSV export. Cells that a spreadsheet could treat as a formula are prefixed
// with an apostrophe so opening the file can never run anything.
import { saveFile } from "./files.js";

export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows, columns) {
  const head = columns.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(","));
  return [head, ...body].join("\r\n");
}

export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  return saveFile(new Blob(["﻿", text], { type }), filename);
}
