# Theming — light & dark mode

**Audience:** anyone editing `Page.html` or `Scripts.html` (Claude Design), and anyone adding the
preference endpoints to `Code.gs`. Read this before changing any colour.

**Status:** in progress on branch `claude/awesome-sagan-63z5lj`. This file is the contract; the
token block in `Page.html` `:root` is the implementation. If the two disagree, fix one of them —
don't fork the rules.

---

## 1. How the theme is chosen

- `<html>` always carries `data-theme="light"` or `data-theme="dark"`. CSS only ever reads that
  attribute — there is **no** `@media (prefers-color-scheme)` block in the stylesheet.
- The member picks **System / Light / Dark** (stored as `"system" | "light" | "dark"`).
  Default is `"system"`. When it is `"system"`, the client resolves it with
  `matchMedia('(prefers-color-scheme: dark)')` and keeps listening, so the app follows the device
  live.
- A tiny inline script at the top of `<head>` sets `data-theme` before first paint (from a
  `localStorage` hint, falling back to the system setting) so the page never flashes light.
- The preference itself lives server-side, per Google account, so it follows the member across
  devices:

  | Owner | Function | Returns |
  |-------|----------|---------|
  | `Code.gs` | `getThemePreference()` | `"system" \| "light" \| "dark"` (default `"system"`) — `PropertiesService.getUserProperties()` |
  | `Code.gs` | `setThemePreference(pref)` | `{ success, theme }` — rejects anything outside the three values |

  These are **not** role-gated — every signed-in account (members, reps, admins, superAdmin,
  `readOnly`) may read and write its own theme. It is not a data write, so `roBlock()` must
  **not** guard it.
- The control sits on **My Profile** (and "My account" for non-members), in its own
  *Appearance* row.

## 2. The token model

Two kinds of token, and the difference is the whole system:

**Shade tokens flip.** `--ink-*`, `--paper-*`, `--gold-*`, `--crimson-*` and the status pairs
(`--present` / `--present-bg`, …) are redefined under `:root[data-theme="dark"]`. In dark mode
`--paper*` are the dark surfaces and `--ink*` are the light text colours, so
`color: var(--ink)` on `background: var(--paper)` keeps working with no change.
Gold, crimson and the five status colours are retuned (lighter fg, deep tinted bg) so they keep
their meaning and contrast.

**Role tokens hold their job in both themes.** Use them where the *job* matters more than the shade:

| Token | Job | Replaces |
|-------|-----|----------|
| `--surface` | Card / sheet / input background that sits on the page | `#fff`, `#FFF`, `white`, `--card` |
| `--surface-sunk` | Recessed well inside a surface | ad-hoc `--paper-100` wells (optional) |
| `--inverse` | **Dark card** background — dark in *both* themes | `background: var(--ink)` on cards |
| `--inverse-raised` | A tile or row inside a dark card | `rgba(243,233,206,0.0x)` washes |
| `--on-inverse` | Main text on a dark card | `color: var(--paper)` on cards |
| `--on-inverse-muted` | Secondary text / labels on a dark card | `--ink-300`/`--ink-400` on cards |
| `--on-inverse-line` | Dividers & borders on a dark card | `rgba(243,233,206,0.15–0.22)` |
| `--on-inverse-accent` | Gold on a dark card | `--gold-300` / `--gold-500` on cards |
| `--on-accent` | Text/icons on a filled gold, crimson or green control | `color: #fff` |
| `--shadow-1`, `--shadow-2` | Small / large elevation | `rgba(20,17,15,…)` box-shadows |
| `--scrim` | Backdrop behind dialogs & sheets | `rgba(43,38,32,…)` overlays |

`--card` stays as an alias of `--surface` so old code keeps working; new code uses `--surface`.

## 3. Rules

1. **No colour literals in UI code.** No hex, `rgb()`/`rgba()` or named colours in `Page.html`
   CSS, in inline `style="…"`, or in HTML strings built by `Scripts.html`. Every colour is a
   `var(--…)`. The only exceptions are listed in rule 8.
2. **Text, borders, quiet fills:** keep using the shade tokens exactly as today
   (`--ink`, `--ink-500`, `--paper-100`, `--paper-200` …). They flip for you.
3. **Selected / primary states invert — and that's correct.** `.btn-primary`, `.chip.active`,
   `.nav-item.active`, checked checkboxes, segmented toggles: keep
   `background: var(--ink); color: var(--paper)`. In dark mode they become a light pill with
   dark text, which is the intended inverted look.
4. **Dark cards stay dark — use the inverse tokens.** Hero cards and strips that are dark *by
   design* — `.card-dark`, `.dash-hero`, `.sess-tally`, `.tally-strip`, `.apol-strip`,
   `.trend-tip`, `.podium-block`, `.dash-busy-pill`, the meeting `.type-badge`, and any inline
   equivalent in `Scripts.html` — use `--inverse` + `--on-inverse*`. **Never** `--ink`/`--paper`
   inside them: those flip, and the card would turn light-on-light.
   Quick test: *"Should this be dark even in light mode?"* Yes → inverse tokens. It's a
   selected state → rule 3.
5. **Surfaces are `--surface`, never white.** Text on a filled gold/crimson/green button is
   `--on-accent`, never `#fff`.
6. **Status colours always travel as a pair.** `--absent-unexc` text sits on
   `--absent-unexc-bg`, etc. Never put a status fg on a hand-picked background.
7. **SVG colours go through CSS.** Chart lines, dots, grid and labels use
   `style="stroke:var(--…)"` / `style="fill:var(--…)"` or a class — not `stroke="#B08538"`.
   (`var()` is not reliable inside SVG presentation attributes.)
8. **Things that never theme:**
   - Email templates (`EmailLayout.html`, `SignatureFooter.html`, `welcome-invite.html`, …) and
     the communiqué signature block (`commSignatureBlock()`): they render in the recipient's inbox.
   - **In-app previews of emails** (welcome-email preview in Add member, communiqué preview): wrap
     the preview root in `class="theme-light"`. That class re-declares the light token values, so
     the preview looks like the inbox in both themes.
   - Print / PDF windows (`openPrintHTML()`): separate document, always light.
   - Member photos and the gold logo images.
9. **Native controls follow the theme.** `color-scheme` is set on `:root` per theme so date
   pickers, selects, scrollbars and autofill go dark too. Don't override it on individual inputs.
10. **New colour need?** Add a token to `:root` **and** its dark value under
    `:root[data-theme="dark"]` in the same edit, then use it. A token with only a light value is a
    bug.

## 4. Before handing back a UI change

- Flip the theme (the Appearance control, or set `document.documentElement.dataset.theme = 'dark'`
  in devtools) and look at every screen you touched.
- Search your diff for `#`, `rgb`, `white` and `fff` in colour positions — rule 1.
- Dark cards: still dark in light mode, still readable in dark mode — rule 4.
- Status pills, the probation bars and the trend chart read clearly in both.

## 5. Ownership

| File | Owner | Theming responsibility |
|------|-------|------------------------|
| `Page.html` | Claude Design | Token block (light + dark), every CSS rule follows §3 |
| `Scripts.html` | Claude Design | Generated HTML follows §3; Appearance control; resolves `system`; calls the two endpoints |
| `Code.gs` | Claude (code) | `getThemePreference()` / `setThemePreference()` only — no colour lives server-side |
| Email templates | — | Out of scope: never themed |
