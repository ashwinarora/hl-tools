import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-4 py-3 sm:py-4">
        <h2 className="m-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="text-foreground no-underline"
          >
            hl-tools
          </Link>
        </h2>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <appkit-button />
        </div>
      </nav>
    </header>
  )
}
