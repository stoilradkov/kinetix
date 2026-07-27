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

### Building screens & interactions

- **Compose shadcn components — never hand-roll UI.** Dialogs, drawers (`Sheet`),
  dropdowns, tables, tabs, etc. come from `src/components/ui/`. If one is missing,
  add it with the CLI (above); do not build a bespoke equivalent.
- **Separate viewing from editing.** Detail / read views are read-only. Put every
  mutating action (create, edit, merge, archive, delete) in a `Dialog` / `Sheet`
  or a distinct actions cluster — never interleave edit controls (inputs, selects)
  inside an informational view.
- **Open a record's detail on demand** — in a `Sheet` (drawer) or `Dialog`
  triggered from its row / card, not an always-visible side panel.
- **Scrollable `Dialog` / `Sheet`: pin the header and footer; scroll only the
  body.** Make the content a bounded flex column (`flex flex-col`, `max-h-[85vh]`
  or `h-full`, `overflow-hidden`, `p-0`); pad a fixed `DialogHeader` /
  `SheetHeader`, an inner `flex-1 overflow-y-auto` body, and a fixed
  `DialogFooter`. Do **not** put `overflow-y-auto` on the panel itself — that makes
  the background scroll and flicker and hides the close button / footer.
- **Report a mutation's error where the action happens** — inside its dialog, next
  to the submit button — not on a global page banner. Reset the error when the
  dialog closes.
- **Paginate long lists** (page indicator + prev / next); never render an
  unbounded table.
- **Make clickable things feel clickable** — pointer cursor (the `Button` and
  `SelectTrigger` primitives already set `cursor-pointer`; add it to custom
  clickable rows) plus a hover state.

### Specialised inputs — never a raw text field

Use the dedicated field components in `src/components/ui/` instead of a plain
`Input` for these input types, and add new masked/typed fields there rather than
re-masking inline:

- **Time zone** → `TimeZoneField` (searchable dropdown over the IANA list).
- **Calendar dates** (`YYYY-MM-DD`) → `DateField` (digit mask, auto hyphens).
- **Decimal measurements** (load, distance, pace, …) → `DecimalField`
  (digit/decimal mask, optional unit `suffix`, validated on blur — never
  mid-keystroke, so typing is not interrupted).
- **Height** → `HeightField` (cm / m / ft-in unit selector; emits canonical
  metres). Model other multi-unit measurements the same way.

These take `value` + `onValueChange` (+ `onBlur`) and compose with `FormField` /
`FormControl` like any other control.

### Data & typography

- Numbers (sets, reps, loads, durations, %) use `font-mono` + `tabular-nums`.
- Body/UI text uses the default `font-sans`.

### Dark mode

- Light is the default; dark is opt-in via the `.dark` class on `<html>` (the
  app does not auto-follow the OS). Both palettes are token-driven.
- **Never** add `dark:` colour overrides. Use the right token and both themes
  work. A component that's correct in light must be correct in dark.

### Adding a token

Edit `src/styles.css` in three places: `@theme inline` (creates the utility),
`:root` (the light value), and `.dark` (the dark value).

## Before you finish

Run from the repo root:

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm --filter @kinetix/web build
```

All must pass. See the repo-root `AGENTS.md` for monorepo-wide conventions.
