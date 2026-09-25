import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { lazy, Suspense } from "react";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { Toaster } from "../components/ui/sonner";

// Dev-only lazy import — Vite replaces `import.meta.env.DEV` with `false` at
// build time. The ternary evaluates to `null`, the lazy() call is dead-code
// eliminated, and the MockPanel chunk is never emitted in production.
const MockPanel = import.meta.env.DEV
	? lazy(() => import("../components/MockPanel"))
	: null;

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

// Optional MSW bootstrap — activates only when the app is opened with the
// `?mock=1` URL param OR `localStorage.mock === "1"`. Dynamic import keeps MSW
// out of production bundles and prevents Nitro SSR from importing browser-only
// modules. Never runs during SSR because of the `window` guard.
if (typeof window !== "undefined" && import.meta.env.DEV) {
	const params = new URLSearchParams(window.location.search);
	const active =
		params.get("mock") === "1" || window.localStorage.getItem("mock") === "1";
	if (active) {
		void import("../mocks/browser").then((m) =>
			m.startMocks().then(() => {
				(window as unknown as { __mswActive: boolean }).__mswActive = true;
			}),
		);
	}
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "hl-tools",
			},
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg",
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased transition-colors duration-200 [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
				<div
					id="bg-layer"
					className="pointer-events-none fixed inset-0 z-0"
					aria-hidden="true"
				/>
				<TanStackQueryProvider>
					<div className="relative z-10 flex min-h-screen flex-col">
						<Header />
						<div className="flex-1">{children}</div>
						<Footer />
					</div>
					<TanStackDevtools
						config={{
							position: "bottom-right",
						}}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
							TanStackQueryDevtools,
						]}
					/>
					{MockPanel && (
						<Suspense fallback={null}>
							<MockPanel />
						</Suspense>
					)}
					<Toaster />
				</TanStackQueryProvider>
				<Scripts />
			</body>
		</html>
	);
}
