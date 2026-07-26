<!-- Keep this file identical to apps/web/CLAUDE.md. -->

# Web app — agent guide

Rules for any agent writing or changing UI in `apps/web`. Stack: React 19, Vite,
TanStack Router/Query/Table, shadcn/ui (new-york), Tailwind CSS v4.

## Design system is mandatory

This app follows the **Kinetic Calm** design system. Full reference:
[`docs/design/DESIGN_SYSTEM.md`](../../docs/design/DESIGN_SYSTEM.md). Do not
introduce a new visual style — extend this one.

### Colour: tokens only

- **Never hardcode colours** — no `bg-blue-500`, `text-emerald-600`, or raw
  hex/oklch in components. Use the semantic utilities backed by tokens in
  `src/styles.css`.
- Neutrals: `bg-background`, `text-foreground`, `bg-card`, `bg-muted`,
  `text-muted-foreground`, `border-border`.
- **Primary action = green:** `bg-primary` / `text-primary-foreground`. The
  default `Button` is already green — just use it.
- **Status meanings:**
    - `success` (green) — everyday positive / hit target.
    - `milestone` (amber-gold) — **rare** big wins only (PR, streak, program
      complete). If you use it more than occasionally, it's wrong; use `success`.
    - `info` (blue) — planned / neutral info.
    - `warning` (amber) — caution / under target.
    - `destructive` (red) — missed / error / delete.

### Use the component primitives

- Status pills → `Badge` with a variant (`success`, `milestone`, `info`,
  `warning`, `destructive`, `outline`, `secondary`).
- Actions → `Button` (`default` green, `outline`, `ghost`).
- Prefer existing primitives in `src/components/ui/`. If a needed shadcn
  component is missing, **add it with the CLI**, don't hand-roll it:

    ```bash
    pnpm --filter @kinetix/web dlx shadcn@latest add <component>
    ```

    New components inherit the palette automatically. Exception: `chart` and
    `sidebar` need tokens we haven't defined (`--chart-*`, `--sidebar-*`) — if you
    add them, define those tokens in `src/styles.css` in the same palette rather
    than accepting shadcn defaults.

### Data & typography

- Numbers (sets, reps, loads, durations, %) use `font-mono` + `tabular-nums`.
- Body/UI text uses the default `font-sans`.

### Dark mode

- It is token-driven and already wired (`.dark` class + OS-preference fallback).
- **Never** add `dark:` colour overrides. Use the right token and both themes
  work. A component that's correct in light must be correct in dark.

### Adding a token

Edit `src/styles.css` in three places: `@theme inline` (creates the utility),
`:root` (light), and both dark blocks (`.dark` + the `@media` fallback).

## Before you finish

Run from the repo root:

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm --filter @kinetix/web build
```

All must pass. See the repo-root `AGENTS.md` for monorepo-wide conventions.
