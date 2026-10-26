# Dark mode — handoff to Claude Design

**From:** Claude Code (theming and backend side) · **Branch:** `claude/awesome-sagan-63z5lj`
**Covers `main` up to:** `8ea7d54` · **Read with:** `docs/THEMING.md` (the rules, the source of
truth) and `.claude/skills/dark-mode-sync/SKILL.md` (how new UI gets synced).

Dark mode is built, but switched off for users. On the way we made decisions that change what
you agreed in `THEMING.md`, and added a few components you'll now see in `Page.html` and
`Scripts.html`. This doc lists them so you can respond, and so your next edits keep dark mode
intact.

---

## 1. What we need from you

1. **Respond to decisions D1–D11 (§3)** with *agree* or *change: …*. Answering by number is fine.
2. **Confirm the working rules (§4).** They are what you follow from now on when writing UI.
3. **Review the Appearance control's look (D11).** It's built from existing components as a
   placeholder; restyle it if you want.
4. **Note the pre-existing bug in §7.** It's yours to fix whenever.

## 2. Where things stand

| Stage | State |
| ------- | ------- |
| 1 · Tokens + plumbing | Done. Light and dark tokens, pre-paint theme script, saved preference, Appearance control (hidden). |
| 2 · `Page.html` sweep | Done. 0 colour literals. |
| 3 · `Scripts.html` sweep | Done. 0 colour literals. |
| 4 · QA + switch on | Next. The user previews on a real device, then sets `DARK_READY = true`. |

**Light mode is pixel-identical to `main`** on 44 renders (22 screens at phone and desktop width,
in admin, member and failed-probation-member views). The one exception is accepted on purpose
(D5). Dark mode was reviewed screen by screen.

---

## 3. Decisions to respond to

### D1 · Rule 4 rewritten: dark cards are *light-token islands*
**Was:** dark cards use `--inverse` + `--on-inverse-*`, never `--ink`/`--paper` inside.
**Now:** in dark mode, every token inside a dark card keeps its **light** value, so the card
looks the same in both themes. You write a dark card exactly as you always have
(`color: var(--paper)`, `var(--gold-300)`, `rgba(var(--on-inverse-rgb), .18)` …). To make a card
an island:
- set its background to `var(--inverse)` instead of `var(--ink)`, and
- add its selector to the island list in the `Page.html` token header, or give the element
  `class="theme-inverse"` (for inline-styled cards built in `Scripts.html`).

**Why:** dark cards use half a dozen shades for their content. Swapping each for an
`--on-inverse-*` token whose light value matches the shade *exactly* needs a new token per shade;
otherwise light mode shifts. Islands keep light mode identical with no new tokens, and you don't
change how you write dark cards.
**Current islands:** `.card-dark`, `.dash-hero`, `.sess-tally`, `.tally-strip`, `.apol-strip`,
`.trend-tip`, `.podium-block`, `.changes-bar`, `.hero-rank`, `.type-badge.meeting`,
`.dash-busy-pill` (not `.dash-busy-wait`), the failed-probation badge, plus two generated cards
with `theme-inverse` (By-member stat card, post-save tally).

### D2 · `--inverse` lifts in dark mode, with no border (amends your §4a)
Dark `--inverse` is `#26211C` on the `#141210` page, so cards separate without a border. A border
would also shift layout by 1px in light mode. `--inverse` sits in its own `:root` rule, outside
the light-token block, so islands inherit the *page's* value and lift instead of sinking. If a
card ever needs more separation, use `outline` (no layout effect), not `border`.

### D3 · Dark `--crimson-600`: `#CF2D37` → `#EC7078`
It's **text** in about 50 places ("AT RISK", warnings, labels). Your value measured 3.26:1 on
`--crimson-100`, 3.63:1 on the page and 2.99:1 on `--crimson-wash`, all under 4.5:1. Now 5.71 /
6.37 / 5.24. In light mode `-600` is the *darker* crimson, for contrast on light backgrounds;
mirrored for dark, it has to be the *lighter* one. You already did this for `--gold-700`.

### D4 · Dark `--absent-unexc`: `#E04D56` → `#E8666E` (from review round 2)
It's small mono pill text on its own background: 4.28:1 before, 5.23:1 now.

### D5 · Segmented toggles get `--seg-active` (the one visible light-mode change)
Dark `--surface` (`#1A1714`) is *darker* than the dark toggle track (`#211D19`), so your §3a fix
would still look sunken. `--seg-active` is `#fff` in light and `#3A342E` in dark. In light,
`.view-mode-toggle` and `.seg-control` active chips move from `--paper` to white. That's barely
visible, and it's the only light change; it's listed in `tools/theme/accepted-light-changes.css`.
The communiqué subtabs already used `#fff`, so they look the same.

### D6 · Alpha washes keep their alphas: RGB-triplet tokens
`Page.html` had about 15 different shadow and wash alphas. Folding them into `--shadow-1/2`
would change light mode. Instead, each call site keeps its alpha and takes the colour from a
triplet: `rgba(var(--shadow-rgb), 0.22)`. Triplets: `--shadow-rgb`, `--scrim-rgb`, `--gold-rgb`,
`--on-inverse-rgb`, `--present-rgb`, `--crimson-rgb`, `--paper-rgb`. `--shadow-1`, `--shadow-2`,
`--scrim` and `--focus-ring` stay as shorthands for new code.

### D7 · Email previews are light islands; the frame around them stays themed
The communiqué letterhead (`#communiquePreview .cp-sheet`) and the welcome-email header and body
(`class="theme-light"`) render as they would in an inbox in both themes. The "live preview" bar
and frame around them go dark. Light islands also reset `color`. An inherited text colour arrives
already computed from the dark page and doesn't re-resolve, so without the reset the welcome
email's "Dear …" line was invisible in dark mode.

### D8 · Light text on a colour fill: `--on-accent` or `--on-inverse`
Fills that had `color: #fff` now use `--on-accent` (white in both themes) on a `*-fill` token.
The crimson emergency marks (`.em-tag`, `.em-callout-mark`, `.req-emergency-count`,
`.em-door-mark`, `.apol-emhint-mark`) used `color: var(--paper)` (`#FBF7EE`), so they use
`--on-inverse`, which is `#FBF7EE` in light, to stay identical. **Question:** do you want these
unified on `--on-accent`? It's a near-invisible light change (`#FBF7EE` → `#fff`) for one rule
instead of two.

### D9 · Small mappings and new tokens
- The checkbox tick uses `var(--surface)`, the colour of the unchecked box, so it inverts with
  the checked fill.
- The switch knob uses `--on-accent` (white in both themes).
- New `--success` (`#2A7D52`, dark `#4FAE7C`, 6.5:1) for the birthday "sent" text and chip.
  `--switch-on` stays the switch track.
- New `--crimson-rgb` and `--paper-rgb` (see D6). `--paper-rgb` flips, so the text on
  probation-bar segments goes dark on the lighter dark-mode status colours.

### D10 · The saved theme is stored per email in Script Properties (info: backend)
`getUserProperties()` would have given every visitor one shared theme: the web app runs as the
deploying account, so user properties are that account's. The full backend notes are in
`docs/handoff/BACKEND-theme-endpoints.md`. For you, the contract is unchanged:
`getUserRole().theme` on load, `setThemePreference(pref)` to save.

### D11 · Rollout gate and the Appearance control
- `DARK_READY` in the boot script (top of `Page.html`) is `false`. Everyone gets light, whatever
  their device or saved preference, and the Appearance control is hidden. The user flips it in
  stage 4. **Please don't change it.**
- To preview dark mode while it's off, run `localStorage.setItem("sc-theme-preview","1")` in the
  console with the app frame selected, then reload. `ScTheme.use("dark")` switches immediately.
- The **Appearance** row is on My Profile ("My account" for non-members), above Sign out: an
  `APPEARANCE · Saved to your account` label and a `.seg-control` with System / Light / Dark.
  It's a placeholder built from your components. **Restyle it as you like**; keep the function
  names (§5).

---

## 4. Working rules from now on (cheat sheet)

The full rules are `THEMING.md` §3. In short:

1. **No colour literals** in CSS, inline styles, or HTML built in `Scripts.html`. Every colour is
   `var(--…)`.
2. **Text, borders, quiet fills:** shade tokens as usual (`--ink`, `--ink-500`, `--paper-100`,
   `--paper-200` …). They flip for you.
3. **Selected states** (primary button, active chip/nav, checked box):
   `background: var(--ink); color: var(--paper)`. They invert in dark mode, which is intended.
4. **Dark card:** `background: var(--inverse)` + island list entry or `class="theme-inverse"`.
   Write the content as in light mode (D1).
5. **Surfaces** are `--surface`, never `#fff`. **Text on a colour fill** is `--on-accent` on a
   `*-fill` token, never `#fff` on a fg token.
6. **Segmented-toggle active chip:** `--seg-active` + `--shadow-1`.
7. **Washes and shadows:** `rgba(var(--…-rgb), alpha)`.
8. **SVG:** `style="fill:var(--…)"` / `style="stroke:var(--…)"`, never `fill="#…"`.
9. **Email previews:** `class="theme-light"` on the email part. Brand literals that must stay
   literal get a `theme-lint: allow` comment.
10. **New colour need:** add the token to the light block **and** the dark block in the same
    edit.
11. **Leave alone:** the boot script's position (first script in `<head>`), `DARK_READY`, and
    the `theme-lint: off/on` markers around the token blocks.

If you miss one, the next sync will find it and fix it on the dark-mode side. Following the rules
means fewer edits to your markup.

---

## 5. Components we added

### In the app

| Component | Where | What it is |
| ----------- | ------- | ------------ |
| **Theme boot script** | `Page.html`, first script in `<head>` (~L5–40) | Sets `<html data-theme="light\|dark">` and `color-scheme` before first paint, from a `localStorage` hint (`sc-theme`), falling back to the system setting. Listens for system changes. Holds the `DARK_READY` gate. |
| **`window.ScTheme`** | defined by the boot script | `get()` → `"system"\|"light"\|"dark"` · `resolved()` → `"light"\|"dark"` · `enabled()` → is dark mode available (gate or preview key) · `use(pref)` → apply locally and remember the hint · `fromServer(pref)` → apply the saved preference from `getUserRole()`. |
| **Light token block** | `Page.html` §1, `:root, .theme-light, #communiquePreview .cp-sheet, :root[data-theme="dark"] :is(…islands…) { … }` | All light values. Its selector list *is* the island list (D1, D7). |
| **`--inverse` rule** | `:root { --inverse: … }`, right after the light block | Kept out of the island list on purpose (D2). |
| **Dark token block** | `:root[data-theme="dark"] { … }` | Dark values for every colour token. |
| **Light-island text reset** | `.theme-light, #communiquePreview .cp-sheet { color: var(--ink); }` | D7. |
| **`.theme-inverse`** | class for markup | Makes an element a dark-card island (D1). |
| **`.theme-light`** | class for markup | Makes an element a light island: email previews (D7). |
| **Lint markers** | comments | `theme-lint: off` … `theme-lint: on` around a block, `theme-lint: allow` on one line. They mark colour literals that are meant to be literal (token blocks, the email brand palette, `#000` inside `color-mix`). Use only for those. |
| **Appearance control** | `Scripts.html`: `appearanceRowHtml()`, `refreshAppearanceRow()`, `setAppearance(pref)` (~L3189–3225); rendered in `renderProfile()` | Returns `''` while `ScTheme.enabled()` is false. `setAppearance` applies instantly, saves with `setThemePreference`, and rolls back with an error toast if the save fails. Not guarded by `roBlock()`, because a theme isn't a data write; view-only accounts may use it. |
| **Boot hook** | `Scripts.html`, first line of the `getUserRole` success handler (~L3920) | `ScTheme.fromServer(r.theme)`. |

**New tokens** (values in `THEMING.md` §6):

| Group | Tokens |
| ------- | -------- |
| Surfaces | `--surface`, `--surface-sunk`, `--seg-active` (`--card` is now an alias of `--surface`) |
| Fills under white text | `--gold-fill`, `--crimson-fill`, `--present-fill`, `--present-fill-hover`, `--late-exc-fill`, `--late-unexc-fill`, `--absent-exc-fill`, `--absent-unexc-fill`, `--on-accent` |
| Dark cards | `--inverse`, `--inverse-raised`, `--on-inverse`, `--on-inverse-muted`, `--on-inverse-line`, `--on-inverse-accent`, `--on-inverse-ok`, `--on-inverse-bad` |
| Triplets / shorthands | `--shadow-rgb`, `--scrim-rgb`, `--gold-rgb`, `--on-inverse-rgb`, `--present-rgb`, `--crimson-rgb`, `--paper-rgb` · `--shadow-1`, `--shadow-2`, `--scrim`, `--focus-ring` |
| Tints | `--tint-soprano`, `--tint-alto`, `--tint-tenor`, `--tint-bass`, `--tint-choir`, `--tint-band`, `--tint-orchestra` |
| One-offs | `--medal-silver`, `--medal-silver-ink`, `--medal-bronze`, `--crimson-wash`, `--switch-on`, `--success` |
| Chart | `--chart-grid`, `--chart-label`, `--chart-line`, `--chart-dot-ring`, `--chart-value` |

### Dev tooling (repo only; Claude Code runs it, you don't need to)
These are `.cjs`, Markdown and CSS files, so `clasp push` never uploads them into Apps Script.

| Tool | What it checks |
| ------ | ---------------- |
| `tools/theme/lint.cjs` | Every colour literal outside the allow markers (target: 0). `--since <commit>` lists only new lines, plus the judgment calls: new `--ink` backgrounds, `--paper` text, status colours used as fills, active chips. Also flags a token defined as itself (`--x: var(--x)`), which silently breaks a colour. |
| `tools/theme/render.cjs` | Renders the real `Page.html` + `Scripts.html` in headless Chromium, with a frozen clock. Fails if light mode differs from `main` by a single pixel, or if dark mode leaks past `DARK_READY`. Saves dark screenshots for review. Views: admin (16 screens), member, member-failed. |
| `tools/theme/fixtures.cjs` | The fake backend those renders use, shaped like `Code.js`'s return values. **When you add an endpoint or a screen, say so in your handoff** so it gets added here and in the render screen list; an unrendered screen is an unchecked screen. |
| `tools/theme/accepted-light-changes.css` | Light changes made on purpose (today only D5), applied to `main`'s render before comparing. |
| `.claude/skills/dark-mode-sync/SKILL.md` | The procedure when new UI lands on `main`: merge, lint, fix with tokens, render, review dark, record in the sync log. |
| `docs/THEMING.md` §8 | The sync log: which `main` commit is covered, and what judgment calls were made. |

---

## 6. Changelog

### `Page.html`

**Stage 1 · tokens and plumbing** (`8019daa`)
- Added the theme boot script and `window.ScTheme` at the top of `<head>`. The charset meta
  stays first, so it's within the first 1,024 bytes.
- `:root` → `:root, .theme-light`, plus `color-scheme: light`. Added the role tokens at light
  values: surfaces, fills, `--on-accent`, triplets and shorthands, inverse/on-inverse, tints,
  medals, `--crimson-wash`, `--switch-on`, chart. `--card` → `var(--surface)`.
- Added the `:root[data-theme="dark"]` block with your values, plus D4 and `--seg-active`.
- A short theming header comment above the tokens pointing to `THEMING.md`.

**Stage 2 · CSS sweep** (`3cf0298`)
- Token blocks wrapped in `theme-lint: off` / `on`.
- Island list added to the light block's selector, and `--inverse` moved to its own `:root` rule
  (D1, D2). New `--crimson-rgb`, `--paper-rgb`, `--success` in both blocks.
- Fills (§2a): `.btn-crimson`, `.btn-gold`, `.btn-green` (+ hover), `.status-primary`,
  `.status-sub`, `.status-five` active buttons (background and border), `.toast` (text) and
  `.toast.success` / `.toast.error`, `.dialog-actions .btn-danger`,
  `.changes-actions .btn-save`, `.edited-badge`, denied / rejoin / pending badges,
  `.comm-subtab-count`. `#fff` text → `--on-accent`.
- Crimson emergency marks: `--crimson` + `--paper` → `--crimson-fill` + `--on-inverse` (D8).
- Surfaces `#fff` → `--surface`: `.card`, checkboxes and checked labels (both `.checkbox-label`
  and `.am-group-toggle`), `.bperson` (+ avatar ring and initial mix), `.bday-setting`,
  `.rejoin-form-card`, `.rejoin-hiatus-card`, `.ep-ms` textarea and labels, roster sticky
  actions, `#communiqueContent`, communiqué radios and toolbar hover, `.sched-row`,
  `.meeting-panel[open]`, `.cp-sheet`. Checkbox tick → `--surface`; switch knob →
  `--on-accent` (D9).
- Segmented actives → `--seg-active` + `--shadow-1`: `.view-mode-toggle`, `.seg-control`,
  `.comm-subtab`, `.comm-mode-btn` (D5).
- Dark cards → `background: var(--inverse)`: `.card-dark`, `.podium-block`,
  `.type-badge.meeting`, `.sess-tally`, `.dash-hero`, `.trend-tip`, `.apol-strip`,
  `.tally-strip`, `.dash-busy-pill`, `.changes-bar`, `.hero-rank`, the failed-probation badge.
- Every `rgba()` → triplets with the same alpha (D6), across shadows, overlays,
  `.more-sheet`, focus rings, dark-card dividers and chips, `.dash-hero-delta` tags,
  `.pp-seg` text, and the busy spinner.
- One-offs → tokens: medals, `.apology-queue-item.emergency` hover/selected
  (`--crimson-wash`), `.bswitch` on (`--switch-on`), birthday "sent" (`--success`), and
  `#A6D7B4` / `#E8A6AB` → `--on-inverse-ok` / `--on-inverse-bad`.
- Static trend chart SVG: colour moved from presentation attributes to
  `style="fill/stroke/stop-color:var(--chart-*)"`.
- `.bbtn--accent`: text → `--on-accent`. The `#000` inside its `color-mix()` stays, with an
  allow marker.

**Stage 3** (`6e3010a`)
- `.theme-light, #communiquePreview .cp-sheet { color: var(--ink); }` (D7).
- Dark `--crimson-600` → `#EC7078` (D3).

### `Scripts.html`

**Stage 1** (`8019daa`)
- `ScTheme.fromServer(r.theme)` as the first line of the `getUserRole` success handler.
- `appearanceRowHtml()`, `refreshAppearanceRow()`, `setAppearance(pref)`. The row is inserted
  in `renderProfile()` view mode, above Sign out (D11).

**Stage 3** (`6e3010a`)
- Section and part tints (`sb-table-row` scoreboard, roster, `sessRoleTint()`) → `--tint-*`.
- Trend chart renderer: grid, labels, line, dots, gradient stops and value label → `--chart-*`
  via `style`.
- `EDITED` and `READY · EVAL` badges → `--gold-fill` + `--on-accent`. The failed-probation `!`
  circle → `--crimson-fill` + `--on-accent`.
- Inline `#fff` → `--surface`: the probation-behind progress track, the restart-reason box, the
  profile photo-edit ring, and the post-save probation result badge.
- Islands: the By-member stat card (`renderMemberHistory`) and the post-save tally
  (`showPostSubmit`) → `class="theme-inverse"` + `background: var(--inverse)`.
- Welcome-email preview header and body → `class="theme-light"`, body `#fff` → `--surface`.
- Communiqué preview body and signature wrappers `#fff` → `--surface` (white inside the
  `.cp-sheet` island).
- Signature palette (`var BL=…` in `commSignatureBlock()`) gets a `theme-lint: allow` marker:
  email brand colours, never themed.

### `Code.js` (summary)
`theme` on `getUserRole()`, `getThemePreference()`, `setThemePreference(pref)`, stored per email
in Script Properties. Details are in `docs/handoff/BACKEND-theme-endpoints.md`. No colour lives
server-side; emails are untouched.

---

## 7. Found along the way (not changed)

- **`Scripts.html` ~L450, the per-section tally strip:** the numbers build their colour as
  `statusColor(s).replace("var(--","").replace(")","")`, which gives a bare `present`. That isn't
  a valid CSS colour, so these numbers have never been coloured in either theme. Probably meant
  `color:' + statusColor(s) + '`.

## 8. How to reply

Something like:

```
D1 agree · D2 agree · D3 agree · D4 agree · D5 agree · D6 agree · D7 agree
D8 unify on --on-accent / keep both
D9 agree · D10 noted · D11 will restyle the Appearance row as …
Rules §4: confirmed / changes: …
```
