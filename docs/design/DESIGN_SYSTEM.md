# Kinetix Design System — "Kinetic Calm"

The visual system for the Kinetix web app. A calm black/white/grey canvas so the
data stays the hero, with colour rationed to two jobs: **green** for everyday
progress and primary actions, and **amber-gold** held back for the rare
milestones (personal records, streaks, a program completed).

- **Where it lives:** `apps/web/src/styles.css` (tokens) and
  `apps/web/src/components/ui/*` (component primitives).
- **Living style guide (visual reference):**
  <https://claude.ai/code/artifact/c445c1ab-8c96-4efa-b439-811791521e9a>
- **Rules agents must follow when writing UI:** `apps/web/AGENTS.md`
  (identical to `apps/web/CLAUDE.md`).

## Principles

1. **Calm neutrals.** True black / white / grey (chroma 0), few clearly-separated
   steps — no wall of near-identical shades.
2. **Two accents, used sparingly.** Green = everyday success + primary action.
   Amber-gold = rare milestones only. If gold shows up more than occasionally,
   it's being misused.
3. **Reserved signal colours.** Blue = planned, amber = caution, red = missed.
   They carry meaning; never use them decoratively.
4. **Data has its own voice.** Numbers (sets, reps, loads, adherence) use the
   monospace stack with `tabular-nums` so columns line up.
5. **Everything is a token.** Components read CSS variables; they never hardcode
   colours. This is what makes both light and dark themes work for free.

## Colour tokens

All values are OKLCH. Each token is available as a Tailwind utility
(`bg-*`, `text-*`, `border-*`). Defined in `apps/web/src/styles.css`.

### Neutrals & surfaces

| Token              | Utility example         | Light       | Dark        | Use                  |
| ------------------ | ----------------------- | ----------- | ----------- | -------------------- |
| `background`       | `bg-background`         | `1 0 0`     | `0.16 0 0`  | Page ground          |
| `foreground`       | `text-foreground`       | `0.17 0 0`  | `0.98 0 0`  | Primary text (ink)   |
| `card` / `popover` | `bg-card`               | `1 0 0`     | `0.205 0 0` | Raised surfaces      |
| `muted`            | `bg-muted`              | `0.965 0 0` | `0.25 0 0`  | Subtle fills, hover  |
| `muted-foreground` | `text-muted-foreground` | `0.5 0 0`   | `0.68 0 0`  | Secondary text       |
| `secondary`        | `bg-secondary`          | `0.965 0 0` | `0.25 0 0`  | Secondary buttons    |
| `border`           | `border-border`         | `0.9 0 0`   | `0.29 0 0`  | Hairline borders     |
| `input`            | `border-input`          | `0.87 0 0`  | `0.34 0 0`  | Form control borders |

### Primary (green) & focus

| Token                | Utility                   | Light            | Dark            | Use             |
| -------------------- | ------------------------- | ---------------- | --------------- | --------------- |
| `primary`            | `bg-primary`              | `0.72 0.185 150` | `0.8 0.19 150`  | Primary actions |
| `primary-foreground` | `text-primary-foreground` | `0.21 0.05 155`  | `0.17 0.04 155` | Text on primary |
| `ring`               | `ring-ring`               | `0.72 0.185 150` | `0.8 0.19 150`  | Focus ring      |

### Semantic status

Each has a base, a `-muted` (pill/background), and a `-foreground` variant.

| Token         | Meaning                 | Light base       | Dark base       | Typical use                              |
| ------------- | ----------------------- | ---------------- | --------------- | ---------------------------------------- |
| `success`     | Everyday positive / hit | `0.72 0.185 150` | `0.8 0.19 150`  | `Badge variant="success"`, ✓ states      |
| `milestone`   | **Rare** big win        | `0.86 0.17 92`   | `0.84 0.16 90`  | PR badge, program-record banner — sparse |
| `info`        | Planned / neutral info  | `0.6 0.13 248`   | `0.72 0.13 248` | `Badge variant="info"` (planned)         |
| `warning`     | Caution / under target  | `0.72 0.14 72`   | `0.82 0.14 78`  | `Badge variant="warning"`                |
| `destructive` | Missed / error / delete | `0.6 0.2 25`     | `0.68 0.19 25`  | `Badge variant="destructive"`, danger    |

> Milestone is a solid fill with dark-ink text (`milestone-foreground`); it is
> intentionally the loudest colour and must stay rare. Status pills for
> success/info/warning use the `-muted` background with the base colour as text.

## Typography

- **`font-sans`** — humanist system stack for UI and prose.
- **`font-mono`** — data: sets, reps, loads, durations, percentages. Pair with
  the `tabular-nums` utility wherever digits align in columns.

## Components

Located in `apps/web/src/components/ui/`. They read tokens, so they are already
theme-aware.

| Component | Notes                                                                 |
| --------- | --------------------------------------------------------------------- |
| `Button`  | `default` is green primary; also `outline`, `ghost`; sizes sm/lg/icon |
| `Input`   | Border uses `input`, focus ring uses `ring`                           |
| `Table`   | Muted header text, hairline row borders                               |
| `Badge`   | Status pills — see variants below                                     |

**Badge variants:** `default` (green solid), `secondary`, `outline`, `success`,
`milestone`, `info`, `warning`, `destructive`. Pills are mono + uppercase.

## Dark mode

Driven entirely by tokens. Dark values are defined in two places in
`styles.css`:

- `.dark { … }` — for an explicit theme class (e.g. a future toggle).
- `@media (prefers-color-scheme: dark) { :root:not(.light) { … } }` — so dark
  follows the OS today, until an explicit `.light` / `.dark` class opts in.

**Rule:** never write theme-specific colours in a component. Use a token and
both themes are handled. If a component looks right in light but wrong in dark,
the fix is almost always "use the correct token," not a `dark:` override.

## Extending the system

### Adding a shadcn component

Add on demand with the CLI — do **not** hand-roll a component that shadcn
provides:

```bash
pnpm --filter @kinetix/web dlx shadcn@latest add dialog
```

New components inherit our palette automatically because they reference the
standard token names (`--primary`, `--muted`, `--border`, …).

> **Caveat — chart & sidebar components.** These reference tokens we have **not**
> defined (`--chart-1..5`, `--sidebar-*`). If you add them, define those tokens
> in `styles.css` in the Kinetic Calm palette (light + dark) — do not accept
> shadcn's default values, which reintroduce off-palette colours. A proper chart
> palette is a deliberate open follow-up.

### Adding a new token

Add it in **three** spots in `styles.css` so utilities and both themes resolve:

1. `@theme inline` — map `--color-x: var(--x)` (this creates the `bg-x`/`text-x`
   utilities).
2. `:root` — the light value.
3. `.dark` **and** the `@media (prefers-color-scheme: dark)` block — the dark
   value (keep the two dark blocks in sync).

## Do / Don't

**Do**

- Use tokens/utilities for every colour.
- Use `Badge` for status; `Button` for actions.
- Reserve `milestone` (gold) for genuinely rare wins.
- Use `font-mono` + `tabular-nums` for data.

**Don't**

- Hardcode Tailwind palette colours (`bg-blue-500`, `text-emerald-600`) or raw
  hex/oklch in components.
- Reach for `milestone` for ordinary success — that's `success`/`primary`.
- Add `dark:` colour overrides — fix the token instead.
- Copy a shadcn component's markup by hand when the CLI can add it.
