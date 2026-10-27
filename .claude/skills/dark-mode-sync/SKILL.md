---
name: dark-mode-sync
description: Bring new UI from main up to dark mode. Use when the user says main has new or changed UI (from Claude Design or anyone else) that needs dark-mode equivalents, asks to "sync dark mode", "check main for new UI", "make the new screens work in dark mode", or before merging or deploying after a UI change. Finds colour that bypasses the design tokens, fixes it under docs/THEMING.md, proves light mode is pixel-identical and dark mode renders, and hands the result back to Design as its baseline.
---

# Dark-mode sync

Claude Design keeps changing `Page.html` and `Scripts.html` on `main`. This brings each change up
to dark mode without changing how light mode looks. Then it hands the result back so Design's next
edit starts from the tokenised files.

**The rules live in `docs/THEMING.md`. Read it first, every time.** The agreement between the
dark-mode session, Design and the backend is `docs/handoff/DARK-MODE-SYNC-PLAN.md`. This skill is
only the procedure. If the three disagree, THEMING.md wins.

## Who owns what

| File | Owner | This skill may… |
| ------ | ------- | ----------------- |
| `Page.html`, `Scripts.html` | Claude Design | change **colour only** (tokens, island list, `theme-inverse` / `theme-light` classes) |
| `Code.js` | Backend conversation | **nothing**: `main`'s version always wins, and contract changes are requested from the backend |
| `tools/theme/*`, `docs/THEMING.md`, this skill | Dark-mode session | anything |

## Tools

| Command | What it tells you |
| --------- | ------------------- |
| `node tools/theme/lint.cjs` | Every colour literal outside the allowed regions in `Page.html` / `Scripts.html`. Once the sweep is complete this is 0. Any hit is UI with no dark equivalent. |
| `node tools/theme/lint.cjs --since <sha>` | Literals on lines added since `<sha>`, plus **judgment calls**: new `background: var(--ink)`, `color: var(--paper)`, fg-token fills, active chips. |
| `node tools/theme/render.cjs [--base <ref>] [--scenario admin\|member\|member-failed\|superadmin]` | Renders every screen in `SCREENS` × phone/desktop with sample data (`fixtures.cjs`). Fails if light mode differs from `<ref>` (default `origin/main`) or dark mode leaks past the `DARK_READY` gate. Writes dark screenshots and an `index.html` gallery to `$TMPDIR/theme-render` (or `--out`). |

Allowed regions are marked in the source with `theme-lint: off` / `theme-lint: on`, or
`theme-lint: allow` for a single line: the token blocks, email previews, and the signature palette.
Add a marker only for a THEMING.md §3 rule 8 exception. Never add one to silence a hit.

## Procedure

### 1. Orient
- `git fetch origin main <dark-mode branch>`.
- **Which phase?** If `origin/main:Page.html` contains `DARK_READY`, dark mode is merged:
  *post-merge*. Otherwise it's *pre-merge*, and the work happens on the dark-mode branch named in
  THEMING.md's status block.
- Find the last synced `main` commit in THEMING.md **§8 Sync log**. Call it `$LAST`.
- `git log --oneline $LAST..origin/main -- Page.html Scripts.html Code.js`:
  - **Nothing** → say so and stop.
  - **Only `Code.js`** → no colour work. Do step 3b (fixtures) and step 5's render, record the sync,
    and tell Design its files are current.
  - **`Page.html` / `Scripts.html`** → full sync.

### 2. Bring the new UI in
- **Pre-merge:** on the dark-mode branch, `git merge origin/main`.
- **Post-merge:** branch from `origin/main`, using the session's designated branch if there is one.
- **Conflicts:**
  - `Code.js`: take `main`'s version, wholesale (`git checkout --theirs Code.js` while merging
    main in). Never hand-merge it.
  - `Page.html` / `Scripts.html`: Design's markup and layout always win. Take Design's version of
    the line, then re-apply the token change on top. Never drop a Design change to keep a token
    edit.

### 3. Find what needs a dark equivalent
**a. Colour**
- `node tools/theme/lint.cjs --summary`. Before the sweep is finished, compare against the
  baseline in THEMING.md §7; afterwards, anything above 0 is new.
- `node tools/theme/lint.cjs --since $LAST` for the full list, plus the judgment calls.
- Skim `git diff $LAST origin/main -- Page.html Scripts.html` too, for things the lint can't see:
  a new dark card built from `--ink`, an email preview, a new chart, a new tab or overlay.
- Read Design's handoff for the drop: it lists the screens added or changed.

**b. Fixtures**
- `git diff $LAST origin/main -- Code.js`: list every new public function (no trailing `_`) and
  every new or changed return field. The doc comment above each function gives the shape, and the
  backend's handoff lists them too.
- Add each one the UI calls to `tools/theme/fixtures.cjs`, shaped exactly like `Code.js` returns
  it. An endpoint missing from the fixtures means its screen renders empty or stuck on a loading
  state, which looks like a pass but checks nothing.

### 4. Fix — tokens only
For each hit, apply THEMING.md §3:
- Literal → the existing token whose *job* matches (§2, §2a–c). If no token fits, add one
  **with both light and dark values in the same edit** (rule 10), and list it in THEMING.md.
- `background: var(--ink)`: is it a selected state (rule 3, keep) or a card that's dark by design
  (rule 4)? Ask: "should this be dark in light mode too?" A dark card becomes a light-token
  island: change its background to `var(--inverse)` and add its selector to the island list in
  the `Page.html` token header. For an inline-styled card in `Scripts.html`, add
  `class="theme-inverse"` instead. Leave its content as Design wrote it.
- Text on a filled colour → `--on-accent` on a `*-fill` token (§2a).
- An email preview → wrap it in `class="theme-light"` and mark its literals (rule 8).
- SVG → `style="stroke:var(--…)"`, never `stroke="#…"` (rule 7).
- Colours that come **from the server** (e.g. birthday `accent` hexes): don't change them in
  `Code.js`. Adapt them on the client for dark mode, e.g. with `color-mix`, if they're used as text
  or icons on a dark surface.

Change colour only. Don't reflow markup, rename classes or reformat lines Design wrote. Small
diffs keep Design's next edit merging cleanly.

### 5. Prove it
- `node tools/theme/render.cjs`, plus `--scenario member` and `--scenario member-failed` if the
  change touches member-facing screens, and `--scenario superadmin` if it touches anything the
  view-only Super Admin sees (the superadmin scenario is added in the first sync). **Every light screen must say `light identical`.** A light
  difference means a token was mapped to the wrong value. Fix the mapping. Only list a change in
  `tools/theme/accepted-light-changes.css` when THEMING.md explicitly accepts it.
- **New tab, panel, dialog or state → add it to `SCREENS` in `render.cjs`** before rendering. A
  screen you can't render is a screen you haven't checked. Include states that only appear with
  certain data (e.g. "with pending apologies", "as section admin", "archived year").
- Open the gallery and **look at every dark screenshot the change touches**. Common problems:
  a light card on the dark page, dark text on a dark fill, a dark card that turned light (it's
  missing from the island list), unreadable status pills, a screen stuck on "Loading…"
  (a fixture is missing).
- Check the render log at the end of the output for gaps.
- `node tools/theme/lint.cjs` must not go up. The goal is 0.

### 6. Record and hand off
- Add a row to THEMING.md **§8 Sync log**: date, the `main` commit synced, what was new, any
  judgment calls made, fixtures/screens added.
- Commit (`theme: dark-mode sync with main @ <short-sha>`) and push to the working branch.
  Open a PR only if the user asks.
- Report to the user:
  - what was new on `main`
  - what you changed and why, especially rule 3 vs rule 4 calls
  - new tokens, if any
  - whether light mode is identical, yes or no
  - anything that needs the user's or Design's eye
  - dark screenshots of new screens, attached if the session can send files
- **Hand back to Design.** If `Page.html` or `Scripts.html` changed, say plainly:
  *"Send these two files to Design as its new baseline before its next edit."* Add a one-line list
  of what changed. If nothing changed in them, say *"Design's files are current."*
- **If `DARK_READY` is `true` on `main`:** remind the user to deploy the Design drop only after this
  sync is merged.

## Don'ts
- Don't flip `DARK_READY`. Switching dark mode on is the user's call (THEMING.md §7 step 4).
- Don't edit email templates, the communiqué signature palette, or print/PDF output (rule 8).
- **Don't edit `Code.js` at all.** The theme endpoints live in `main`'s `Code.js`, maintained by the
  backend conversation. If the contract needs a change, say so in the report.
- Don't accept a light-mode difference to get a green run.
- Don't count a screen as checked if it rendered empty or on a loading state.
