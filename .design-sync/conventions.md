# Y&Y Ticket Control — how to build with this design system

A Hebrew, right-to-left field-operations tool. Light theme only, high contrast, generous
touch targets: the primary user is a site foreman reading a phone in direct sunlight with
gloves on. Consistency outranks novelty here — prefer a library component over new markup.

Components are on `window.YyTicketControl` (29 of them) plus four class helpers.
No provider or theme wrapper is required — import a component and render it.

## RTL is not optional

Every screen is right-to-left. `styles.css` sets `html { direction: rtl }`, so direction is
inherited automatically — **but physical utility classes are still wrong and fail silently.**

- Use **logical** classes only: `ms-*`/`me-*`, `ps-*`/`pe-*`, `text-start`/`text-end`,
  `border-s`/`border-e`, `start-*`/`end-*`.
- Never `ml-*`, `pr-*`, `text-left`, `border-l`, `left-*` — they pin content to the wrong
  edge and nothing warns you.
- Hebrew text with a Latin/numeric run (a phone number, a time) needs `dir="ltr"` on that
  element, or `16:45` renders as `45:16`.

The font is **Heebo**, already wired through `styles.css`. Don't set `font-family`.

## The styling idiom: Tailwind v4 with semantic tokens

Colors are **named by meaning, never by hue**. The full palette — there is no other:

| Token | Use |
|---|---|
| `bg` | page background (cool grey) |
| `surface` | card / panel background (white) |
| `border` | every divider and outline |
| `fg` / `muted` | body text / secondary text |
| `brand` / `brand-fg` | primary action, links, selected state / text on top of it |
| `danger` | destructive action, blocked work, draft |
| `success` | completed |
| `warning` | awaiting a decision |

Each combines with `bg-`, `text-`, `border-`, and with an opacity suffix for weak
backgrounds: `bg-brand/10` with `border-brand/30` is the standard soft-state pair.
Examples: `bg-brand text-brand-fg`, `border border-border bg-surface`, `text-muted`,
`bg-danger/10 border-danger/30 text-danger`.

Do **not** invent `bg-blue-600`, `text-gray-500`, `#204ab4`, or a shadow for elevation —
separation is a `border` on `surface`, because shadows are invisible in sunlight.

Sizing follows a 4px scale (`gap-2`, `p-4`, `px-6`). Two rules that are load-bearing:

- **Touch targets**: `min-h-12` (48px) for a primary action, `min-h-11` (44px) is the
  absolute floor, never smaller.
- **Inputs stay `text-base`** at every size — iOS Safari zooms the whole page when a
  focused control is under 16px, and the user is left on a shifted screen.

Radii: `rounded-lg` (compact controls), `rounded-xl` (default controls), `rounded-2xl` (cards).

## Class helpers, for elements that aren't components

When the element must be an `<a>`, an `<li>`, or a `<section>`, use the helper instead of
copying classes — it is the same source of truth the components use:

`buttonClasses(variant, size, extra)` · `chipClasses(tone, variant, size, extra)` ·
`cardClasses(layout, {tone, padding})` · `controlClasses(size, invalid, extra)`

`className` on a component is for **layout only** (`self-start`, `flex-1`, `w-full`).
Color, height, padding and weight belong to the component's `variant`/`size` props.

## Where the truth lives

- `guidelines/docs/DESIGN.md` — the full spec: colour calibration, typography scale,
  elevation, per-component rules. Read it before inventing anything.
- `components/general/<Name>/<Name>.prompt.md` — per-component API and intent.
- `styles.css` and its imports — the actual tokens and utilities that exist.

## A representative screen

```jsx
const { ButtonLink, FilterBar, FilterSelect, TicketCard } = window.YyTicketControl;

<main className="flex flex-col gap-4 p-4">
  <div className="flex flex-wrap items-center gap-2">
    <h1 className="text-2xl font-bold">לוח הפניות</h1>
    <ButtonLink href="/tickets/new" className="ms-auto">+ פנייה חדשה</ButtonLink>
  </div>

  <FilterBar activeCount={1}>
    <FilterSelect defaultValue="" aria-label="אתר">
      <option value="">כל האתרים</option>
    </FilterSelect>
  </FilterBar>

  <ul className="flex flex-col gap-2">
    <li><TicketCard card={card} /></li>
  </ul>
</main>
```

Note `ms-auto` (not `ml-auto`) to push the action to the far edge, `text-2xl font-bold`
from the scale rather than a hand-picked size, and layout-only `className`.
