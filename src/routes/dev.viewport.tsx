import { createFileRoute, notFound } from "@tanstack/react-router";

/**
 * Development-only viewport harness used for screenshot review:
 *   /dev/viewport?path=/tools/assets&w=375&h=812
 * Renders the route in a same-origin iframe of exact CSS size, so media
 * queries respond to the frame width. Stripped from production (404).
 */
export const Route = createFileRoute("/dev/viewport")({
	validateSearch: (s: Record<string, unknown>) => ({
		path: typeof s.path === "string" ? s.path : "/",
		w: Number(s.w) || 1440,
		h: Number(s.h) || 900,
	}),
	beforeLoad: () => {
		if (!import.meta.env.DEV) throw notFound();
	},
	component: Harness,
});

function Harness() {
	const { path, w, h } = Route.useSearch();
	return (
		<div className="fixed inset-0 z-[200] overflow-auto bg-neutral-500 p-4">
			<div className="mb-2 font-mono text-xs text-white">
				{w}×{h} — {path}
			</div>
			<iframe
				title="viewport"
				src={path}
				style={{ width: w, height: h, border: 0, background: "white" }}
			/>
		</div>
	);
}
