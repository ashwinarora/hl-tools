# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # Install dependencies
bun --bun run dev        # Dev server on port 3000
bun --bun run build      # Production build
bun --bun run test       # Run tests (vitest)
bun --bun run check      # Biome lint + format check
bun --bun run lint       # Lint only
bun --bun run format     # Format only
node .output/server/index.mjs  # Run production build
```

## Architecture

**TanStack Start** full-stack React app with SSR, using Nitro as the server runtime and Vite as the bundler.

- **Routing**: TanStack Router with file-based routing in `src/routes/`. The route tree is auto-generated in `src/routeTree.gen.ts` (do not edit). Root layout lives in `src/routes/__root.tsx`.
- **Data fetching**: TanStack Query integrated via `src/integrations/tanstack-query/`. The router context includes a `QueryClient`.
- **MCP server**: An MCP (Model Context Protocol) endpoint at `/mcp` (`src/routes/mcp.ts`) using `@modelcontextprotocol/sdk` with an in-memory transport adapter (`src/utils/mcp-handler.ts`). Tools are registered on the server instance; todo state persists to `mcp-todos.json`.
- **Styling**: Tailwind CSS v4 via Vite plugin. Global styles in `src/styles.css`. Theme toggling (light/dark/auto) with inline script in root layout.
- **UI components**: shadcn/ui (new-york style, no RSC). Add components with `pnpm dlx shadcn@latest add <component>`. Components go to `src/components/ui/`, utils to `src/lib/utils.ts`.

## Code Style

- **Formatter/Linter**: Biome with tabs, double quotes, recommended rules. `src/routeTree.gen.ts` and `src/styles.css` are excluded from linting.
- **TypeScript**: Strict mode, no unused locals/params. Path alias `#/*` maps to `src/*` (used in imports).
- **Deployment**: Nixpacks config in `nixpacks.toml` (Node.js 22).
