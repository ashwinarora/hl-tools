import { Fragment } from "react";
import type { Part } from "../model/parts";
import { shortAddress } from "../model/stage";
import { When } from "../shell/live";
import { Who } from "./Names";

/**
 * A sentence built by a model, shown the section's way: an address with its
 * nickname in this treasury (when it has one), a moment in the reader's own
 * time zone with UTC on hover. Words like "You" stay words.
 */
export function Sentence({ parts }: { parts: readonly Part[] }) {
	return (
		<>
			{parts.map((p, i) => {
				// the parts of one fixed sentence: their order is their identity
				const key = `${i}:${p.text}`;
				if (p.who !== undefined)
					return p.text === shortAddress(p.who) ? (
						<Who key={key} address={p.who} />
					) : (
						<Fragment key={key}>{p.text}</Fragment>
					);
				if (p.when !== undefined) return <When key={key} at={p.when} />;
				if (p.strong)
					return (
						<b key={key} className="font-semibold">
							{p.text}
						</b>
					);
				if (p.quiet)
					return (
						<span key={key} className="text-muted-foreground">
							{p.text}
						</span>
					);
				return <Fragment key={key}>{p.text}</Fragment>;
			})}
		</>
	);
}
