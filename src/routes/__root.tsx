import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useEffect } from "react";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { Toaster } from "../components/ui/sonner";
import { NETWORK_INIT_SCRIPT, useNetworkStore } from "../store/networkStore";

// TanStack devtools are opt-in during development (`?devtools=1` or
// localStorage.devtools = "1") so the floating launcher doesn't cover tool UI.
const showDevtools =
	import.meta.env.DEV &&
	typeof window !== "undefined" &&
	(new URLSearchParams(window.location.search).get("devtools") === "1" ||
		window.localStorage.getItem("devtools") === "1");

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

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
				title: "hl-tools — Hyperliquid developer tools",
			},
			{
				name: "description",
				content:
					"Read-only diagnostics for Hyperliquid developers: resolve assets, inspect signatures, decode CoreWriter actions, trace HyperEVM → HyperCore, lint orders, debug WebSockets and probe RPCs.",
			},
			{ name: "theme-color", content: "#0f1115" },
		],
		links: [
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700&display=swap",
			},
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

/** Rehydrate the persisted network after mount (store uses skipHydration). */
function NetworkHydrator() {
	useEffect(() => {
		void useNetworkStore.persist.rehydrate();
	}, []);
	return null;
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant pre-hydration theme script */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant pre-hydration network script */}
				<script dangerouslySetInnerHTML={{ __html: NETWORK_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased">
				<a
					href="#main"
					className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-brand"
				>
					Skip to content
				</a>
				<NetworkHydrator />
				<TanStackQueryProvider>
					<div className="relative flex min-h-screen flex-col">
						<Header />
						<div id="main" className="flex-1">
							{children}
						</div>
						<Footer />
					</div>
					{showDevtools && (
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
					)}
					<Toaster />
				</TanStackQueryProvider>
				<Scripts />
			</body>
		</html>
	);
}
