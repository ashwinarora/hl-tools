import { toast } from "sonner";
import { TOAST_MS, type ToastText } from "../model/toasts";

/**
 * Says a result in a toast (`model/toasts.ts` writes it), whatever the page
 * shows: success and failure alike close by themselves.
 */
export function notify(t: ToastText): void {
	const show =
		t.tone === "done"
			? toast.success
			: t.tone === "unsure"
				? toast.warning
				: toast.error;
	show(t.title, {
		description: t.line,
		duration: t.tone === "done" ? TOAST_MS.done : TOAST_MS.failed,
	});
}
