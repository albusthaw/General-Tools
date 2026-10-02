// CSV export. Cells that a spreadsheet could treat as a formula are prefixed
// with an apostrophe so opening the file can never run anything.

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
  const blob = new Blob(["﻿", text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
