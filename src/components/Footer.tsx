import { Separator } from "#/components/ui/separator";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="px-4 pb-8 pt-6 text-muted-foreground">
      <div className="page-wrap flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">hl-tools</span>
          <span className="text-sm">Hyperliquid tools &amp; utilities</span>
        </div>
        <p className="text-sm">&copy; {year} hl-tools</p>
      </div>
    </footer>
  );
}
