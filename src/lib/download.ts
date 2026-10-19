/** Save text as a file from the browser (a Blob URL and a synthetic click). */
export function download(
	filename: string,
	text: string,
	type = "application/json",
): void {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A cell of a CSV file: text, a number, or nothing. */
export type CsvCell = string | number | null | undefined;

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * One cell as RFC 4180 has it: quoted where it holds a comma, a quote or a
 * line break, or starts or ends with a space; quotes doubled. A cell that a
 * spreadsheet would run as a formula (one starting with =, +, -, @, a tab
 * or a carriage return, and not a plain number) is opened with an
 * apostrophe, so it reads as text.
 */
export function csvCell(v: CsvCell): string {
	if (v === null || v === undefined) return "";
	let s = String(v);
	if (/^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
	return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV file: one header row, then a record per row, each ended by CRLF. */
export function toCsv(
	columns: readonly string[],
	rows: readonly (readonly CsvCell[])[],
): string {
	return `${[columns, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** A moment in a CSV file, in UTC ("2026-10-14 02:54:01"): spreadsheets read it as a date. */
export function csvTime(ms: number): string {
	return Number.isFinite(ms) && ms > 0
		? new Date(ms).toISOString().slice(0, 19).replace("T", " ")
		: "";
}

/** Save a CSV file. The byte-order mark makes spreadsheets read it as UTF-8. */
export function downloadCsv(filename: string, csv: string): void {
	download(filename, `﻿${csv}`, "text/csv;charset=utf-8");
}
