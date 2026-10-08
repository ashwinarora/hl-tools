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
