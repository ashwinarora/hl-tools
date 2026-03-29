import { useEffect, useState } from "react";

type ResolvedTheme = "light" | "dark";

function getResolved(): ResolvedTheme {
	if (typeof document === "undefined") return "light";
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useResolvedTheme(): ResolvedTheme {
	const [theme, setTheme] = useState<ResolvedTheme>(getResolved);

	useEffect(() => {
		const observer = new MutationObserver(() => {
			setTheme(getResolved());
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, []);

	return theme;
}
