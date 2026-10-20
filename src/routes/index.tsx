import { createFileRoute } from "@tanstack/react-router";
import { SITE } from "#/components/home/facts";
import { HomePage } from "#/components/home/HomePage";
import homeCss from "#/components/home/home.css?url";
import { shareMeta } from "#/lib/site";

export const Route = createFileRoute("/")({
	head: () => ({
		meta: [
			{ title: SITE.title },
			{ name: "description", content: SITE.description },
			...shareMeta({ path: "/" }),
		],
		links: [{ rel: "stylesheet", href: homeCss }],
	}),
	component: HomePage,
});
