// CSV for spreadsheets (Numbers, Excel, Google Sheets). Pure, so it can be unit tested.

export type Cell = string | number | null | undefined;

/** One cell: quoted when needed, and text that a spreadsheet would run as a formula is defused. */
function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  // A cell starting with = + - @ (or a tab/CR) is treated as a formula by spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows to CSV text, with a byte-order mark so Excel reads accents (Beyoncé) correctly. */
export function toCsv(rows: Cell[][]): string {
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
