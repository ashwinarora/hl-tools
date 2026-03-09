import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";

type ThemeMode = "light" | "dark" | "auto";

function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") {
		return "auto";
	}

	const stored = window.localStorage.getItem("theme");
	if (stored === "light" || stored === "dark" || stored === "auto") {
		return stored;
	}

	return "auto";
}

function applyThemeMode(mode: ThemeMode) {
	const prefersDark = window.matchMedia(
		"(prefers-color-scheme: dark)",
	).matches;
	const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;

	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(resolved);

	if (mode === "auto") {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", mode);
	}

	document.documentElement.style.colorScheme = resolved;
}

export default function ThemeToggle() {
	const [mode, setMode] = useState<ThemeMode>("auto");

	useEffect(() => {
		const initialMode = getInitialMode();
		setMode(initialMode);
		applyThemeMode(initialMode);
	}, []);

	useEffect(() => {
		if (mode !== "auto") {
			return;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyThemeMode("auto");

		media.addEventListener("change", onChange);
		return () => {
			media.removeEventListener("change", onChange);
		};
	}, [mode]);

	function handleChange(value: string) {
		const next = value as ThemeMode;
		setMode(next);
		applyThemeMode(next);
		window.localStorage.setItem("theme", next);
	}

	const icon =
		mode === "dark" ? (
			<Moon className="h-4 w-4" />
		) : mode === "light" ? (
			<Sun className="h-4 w-4" />
		) : (
			<Monitor className="h-4 w-4" />
		);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label="Toggle theme">
					{icon}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup value={mode} onValueChange={handleChange}>
					<DropdownMenuRadioItem value="light">
						<Sun className="mr-2 h-4 w-4" />
						Light
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark">
						<Moon className="mr-2 h-4 w-4" />
						Dark
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="auto">
						<Monitor className="mr-2 h-4 w-4" />
						System
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
