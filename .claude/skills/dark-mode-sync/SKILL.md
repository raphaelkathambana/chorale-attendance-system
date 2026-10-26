---
name: dark-mode-sync
description: Bring new UI from main up to dark mode. Use when the user says main has new or changed UI (from Claude Design or anyone else) that needs dark-mode equivalents, asks to "sync dark mode", "check main for new UI", "make the new screens work in dark mode", or before merging or deploying after a UI change. Finds colour that bypasses the design tokens, fixes it under docs/THEMING.md, and proves light mode is pixel-identical and dark mode renders.
---

# Dark-mode sync

Claude Design keeps changing `Page.html` and `Scripts.html` on `main`. This brings each change up
to dark mode without changing how light mode looks.

**The rules live in `docs/THEMING.md`. Read it first, every time.** This skill is only the
procedure, and THEMING.md wins if the two disagree.

## Tools

| Command | What it tells you |
| --------- | ------------------- |
| `node tools/theme/lint.cjs` | Every colour literal outside the allowed regions in `Page.html` / `Scripts.html`. Once the sweep is complete this is 0. Any hit is UI with no dark equivalent. |
| `node tools/theme/lint.cjs --since <sha>` | Literals on lines added since `<sha>`, plus **judgment calls**: new `background: var(--ink)`, `color: var(--paper)`, fg-token fills, active chips. |
| `node tools/theme/render.cjs [--base <ref>]` | Renders 12 screens × phone/desktop with sample data (`fixtures.cjs`). Fails if light mode differs from `<ref>` (default `origin/main`) or dark mode leaks past the `DARK_READY` gate. It writes dark screenshots and an `index.html` gallery to `$TMPDIR/theme-render` (or `--out`). |

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
- `git log --oneline $LAST..origin/main -- Page.html Scripts.html`. If that's empty, there's
  nothing to sync: say so and stop.

### 2. Bring the new UI in
- **Pre-merge:** on the dark-mode branch, `git merge origin/main`.
- **Post-merge:** branch from `origin/main`, using the session's designated branch if there is one.
- **Conflicts:** Design's markup and layout always win. Take Design's version of the line, then
  re-apply the token change on top. Never drop a Design change to keep a token edit.

### 3. Find what needs a dark equivalent
- `node tools/theme/lint.cjs --summary`. Before the sweep is finished, compare against the
  baseline in THEMING.md §7; afterwards, anything above 0 is new.
- `node tools/theme/lint.cjs --since $LAST` for the full list, plus the judgment calls.
- Skim `git diff $LAST origin/main -- Page.html Scripts.html` too, for things the lint can't
  see: a new dark card built from `--ink`, an email preview, a new chart, a new tab or overlay.

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

Change colour only. Don't reflow markup, rename classes or reformat lines Design wrote. Small
diffs keep Design's next edit merging cleanly.

### 5. Prove it
- `node tools/theme/render.cjs`. **Every light screen must say `light identical`.** A light
  difference means a token was mapped to the wrong value. Fix the mapping. Only list a change in
  `tools/theme/accepted-light-changes.css` when THEMING.md explicitly accepts it.
- Open the gallery and **look at every dark screenshot the change touches**. Common problems:
  a light card on the dark page, dark text on a dark fill, a dark card that turned light (it's
  missing from the island list), unreadable status pills.
- Check the render log at the end of the output. A new endpoint or field Design added appears
  as a gap: extend `tools/theme/fixtures.cjs`. A new tab or screen: add it to `SCREENS` in
  `render.cjs`. A screen you can't render is a screen you haven't checked.
- `node tools/theme/lint.cjs` must not go up. The goal is 0.

### 6. Record and hand off
- Add a row to THEMING.md **§8 Sync log**: date, the `main` commit synced, what was new, any
  judgment calls made.
- Commit (`theme: dark-mode sync with main @ <short-sha>`) and push to the working branch.
  Open a PR only if the user asks.
- Report: what was new on `main`, what you changed and why (especially rule 3 vs 4 calls),
  light identical yes/no, and anything that needs the user's or Design's eye. Attach dark
  screenshots of new screens if the session can send files.

## Don'ts
- Don't flip `DARK_READY`. Switching dark mode on is the user's call (THEMING.md §7 step 4).
- Don't edit email templates, the communiqué signature palette, or print/PDF output (rule 8).
- Don't touch `Code.js` beyond the theme endpoints. Data and logic aren't part of a theme sync.
- Don't accept a light-mode difference to get a green run.
