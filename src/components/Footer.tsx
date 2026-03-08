export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 border-t border-border px-4 pb-14 pt-10 text-muted-foreground">
      <div className="page-wrap text-center text-sm">
        &copy; {year} hl-tools
      </div>
    </footer>
  )
}
