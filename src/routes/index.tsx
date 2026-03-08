import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <main className="page-wrap px-4 py-12">
      <h1 className="text-4xl font-bold">hl-tools</h1>
    </main>
  )
}
