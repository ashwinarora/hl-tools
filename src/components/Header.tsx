import { Link } from "@tanstack/react-router";
import { Wrench } from "lucide-react";
import { Separator } from "#/components/ui/separator";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 backdrop-blur-lg">
      <nav className="page-wrap flex h-14 items-center gap-x-4 sm:h-16">
        <Link
          to="/"
          className="flex items-center gap-2 text-foreground no-underline"
        >
          <Wrench className="h-5 w-5" />
          <span className="text-base font-bold tracking-tight">hl-tools</span>
        </Link>

        <Link
          to="/how-to-use"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          How to Use
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Separator orientation="vertical" className="h-6" />
          <appkit-button />
        </div>
      </nav>
    </header>
  );
}
