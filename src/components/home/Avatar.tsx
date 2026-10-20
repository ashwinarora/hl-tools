import { cn } from "#/lib/utils";

/** A signer of the example treasury as a coloured initial. */
const HUES: Record<string, string> = {
	Alice: "bg-brand/85",
	Bob: "bg-info/85",
	Carol: "bg-unknown/85",
};

export function Avatar({ name, ring }: { name: string; ring?: boolean }) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-background",
				ring ? "size-6 ring-2 ring-background" : "size-5",
				HUES[name] ?? "bg-border-strong",
			)}
			aria-hidden
		>
			{name[0]}
		</span>
	);
}
