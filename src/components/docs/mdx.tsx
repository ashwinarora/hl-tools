/**
 * What a docs page can use: Fumadocs' own components (cards, callouts,
 * steps, tabs, folded sections, zoomable images) and the docs' own (Shot,
 * Video, TryIt, Diagram). Each of the docs' own has a Markdown form for the
 * page's copy in `src/lib/docs/remark.ts`.
 */
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { Diagram } from "./diagrams";
import { Shot, Video } from "./media";
import { TryIt } from "./TryIt";
import { WalletPrompt } from "./WalletPrompt";

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		img: (props: ComponentProps<"img">) => (
			<ImageZoom {...(props as ComponentProps<typeof ImageZoom>)} />
		),
		Accordion,
		Accordions,
		Step,
		Steps,
		Tab,
		Tabs,
		Shot,
		Video,
		TryIt,
		Diagram,
		WalletPrompt,
		...components,
	} satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
