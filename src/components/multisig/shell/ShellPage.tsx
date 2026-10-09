import type { ReactNode } from "react";
import { PageHead } from "./kit";

/** One screen inside the shell: a head (title, facts, actions) and its content. */
export function ShellPage({
	title,
	meta,
	actions,
	back,
	children,
}: {
	title: ReactNode;
	meta?: ReactNode;
	actions?: ReactNode;
	back?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			<PageHead title={title} meta={meta} actions={actions} back={back} />
			{children}
		</>
	);
}
