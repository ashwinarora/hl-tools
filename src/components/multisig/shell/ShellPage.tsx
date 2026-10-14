import { createContext, type ReactNode, useContext } from "react";
import { PageHead } from "./kit";

/**
 * What the shell shows right under every page's title: on a phone, the
 * wallet bar and the one-time notice. The title comes first, so a reader
 * sees where they are before anything else.
 */
const BelowTitle = createContext<ReactNode>(null);
export const BelowTitleProvider = BelowTitle.Provider;

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
	const below = useContext(BelowTitle);
	return (
		<>
			<PageHead title={title} meta={meta} actions={actions} back={back} />
			{below}
			{children}
		</>
	);
}
