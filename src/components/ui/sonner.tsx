"use client";

import { useEffect, useState } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

type Theme = "light" | "dark" | "system";

function useThemeFromDom(): Theme {
	const [theme, setTheme] = useState<Theme>("dark");
	useEffect(() => {
		if (typeof document === "undefined") return;
		const read = () => {
			const attr = document.documentElement.getAttribute("data-theme");
			if (attr === "light" || attr === "dark") setTheme(attr);
			else if (document.documentElement.classList.contains("dark"))
				setTheme("dark");
			else setTheme("light");
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "class"],
		});
		return () => observer.disconnect();
	}, []);
	return theme;
}

export function Toaster(props: ToasterProps) {
	const theme = useThemeFromDom();
	return (
		<SonnerToaster
			theme={theme}
			position="bottom-right"
			closeButton
			toastOptions={{
				classNames: {
					toast:
						"group border border-border bg-card text-card-foreground shadow-lg",
					description: "text-muted-foreground",
					actionButton: "bg-primary text-primary-foreground",
					cancelButton: "bg-muted text-muted-foreground",
					// a tint painted over the card's solid colour: a see-through toast lets
					// the page's text run through its own
					error:
						"!border-destructive/50 !bg-card ![background-image:linear-gradient(color-mix(in_oklab,var(--destructive)_10%,transparent),color-mix(in_oklab,var(--destructive)_10%,transparent))] !text-destructive",
					success:
						"!border-emerald-500/40 !bg-card ![background-image:linear-gradient(color-mix(in_oklab,var(--color-emerald-500)_10%,transparent),color-mix(in_oklab,var(--color-emerald-500)_10%,transparent))]",
					warning:
						"!border-warning/40 !bg-card ![background-image:linear-gradient(var(--warning-soft),var(--warning-soft))] !text-warning",
				},
			}}
			{...props}
		/>
	);
}
