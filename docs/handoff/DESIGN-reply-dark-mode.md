# Dark mode — reply from Claude Design

**From:** Claude Design · **Date:** 27 Oct 2026
**Replies to:** `DESIGN-dark-mode.md` §8 and `DARK-MODE-SYNC-PLAN.md` §7
**Checked against:** Design's current `port/Page.html` + `port/Scripts.html` (the 26 Oct drop)
Suggested home: `docs/handoff/DESIGN-reply-dark-mode.md`

**Verdict:** proceed with the first sync as planned.

## 1. Decisions

```
D1 agree · D2 agree · D3 agree · D4 agree · D5 agree (replaces my --surface-raised)
D6 agree · D7 agree
D8 unify on --on-accent, after the merge (see below)
D9 agree · D10 noted
D11 keep the seg-control; one copy change (see below)
Rules §4: confirmed, no changes.
```

- **D8:** unify, but don't do it in the first sync, so that sync stays pixel-identical. It will be my first change on the new baseline. The five emergency marks move to `--crimson-fill` + `--on-accent`, and `--on-inverse` goes back to dark cards only.
- **D11:** when **System** is selected, the sub-label should read `Following your device · Dark` (or `· Light`). Light and Dark keep `Saved to your account`. I'll make the change after step 4. Function names stay the same.

## 2. Sync plan §4.1: corrections

Everything listed is built, including the Group Dashboard v3 panels and the Record date-picker `min` (`ad.min = yearInfo.currentStartsOn`). I don't know of anything missing. Two items use different wording from the plan, which matters for fixtures and screen labels:

- **Activity log header:** the header reads `N changes · <year>` with `Newest first · showing N`. It doesn't say "Showing N of total".
- **Apology status:** the copy comes from `myApologyView()`:
  - `Apology sent · waiting for review` (or `Emergency apology sent · …`)
  - `Apology accepted`
  - `Apology closed …`
  - `Covered by your long-term apology (…)`

  The fixtures need one `myApology` for each: `Pending`, `Approved`, `Not needed`, and long-term pending and accepted.

Add to `SCREENS`: the **view-only Super Admin** scenario (action controls hidden, communiqué hidden). It's in §4.1 but not in the render list.

## 3. Baseline

Confirmed. I won't edit `port/Page.html` or `port/Scripts.html` between step 0 and step 4. At step 4 I replace both with the merged files and start all later work from them.

## 4. Birthday accents (sync plan 2.2)

**The spec is mine; the sync implements it** in stage 4, since it's token-layer work and needs the pixel check.

As text on dark `--surface` (`#1A1714`), four of the seven accents fail:

| Accent | Contrast | Result |
|---|---|---|
| `#993556` | 2.55 | fails |
| `#534AB7` | 2.58 | fails |
| `#185FA5` | 2.74 | fails |
| `#0F6E56` | 2.88 | fails |
| `#D85A30` | 4.61 | passes |
| `#BA7517` | 4.80 | passes |
| `#1D9E75` | 5.27 | passes |

Fix: add a dark-only derived token. Declare it on the elements that carry the inline `--bday-accent` / `--accent`:

```css
.bday-banner{--bday-accent-ink:var(--bday-accent)}
.bperson{--accent-ink:var(--accent)}
:root[data-theme="dark"] .bday-banner{--bday-accent-ink:color-mix(in srgb,var(--bday-accent) 60%,var(--ink))}
:root[data-theme="dark"] .bperson{--accent-ink:color-mix(in srgb,var(--accent) 60%,var(--ink))}
```

- **Use `*-ink` for text, icons, avatar rings and focus borders:** `Page.html` ~L884, L889, L906, L956, L975.
- **Keep the raw accent for fills:** the 4 px `.bperson` stripe and `.bbtn--accent`.
- **Result:** every accent measures 5.46–7.97:1 on `--surface` and at least 5.68:1 on the 16% wash. Light mode is unchanged.

There's also an existing problem in both themes, outside this work: white on `.bbtn--accent` is under 4.5:1 for `#1D9E75` (3.39), `#BA7517` (3.72) and `#D85A30` (3.87). Flagged only.

## 5. The §7 bug (tally strip, `Scripts.html` L449)

The bug is real, but **don't apply the suggested fix.**

- **Why not:** `.tally-strip` is a dark island. Light-value status colours on `#14110F` would be low-contrast; `--absent-unexc` would be 2.8:1.
- **Intended design:** plain numbers with the abbreviation in `--ink-300`. That is what renders today.
- **Fix:** delete the dead `style="color:…"` from the `.num` span. It makes no visual change in either theme, so it can go in the first sync.

## 6. Design-side housekeeping (done)

- **Superseded:** `THEMING (reviewed).md` now points to `docs/THEMING.md`.
- **Canvas updated:** `Chorale Design · Dark Mode.html` now uses the D2–D5 values: no card outline, `--crimson-600` `#EC7078`, `--absent-unexc` `#E8666E`, `--seg-active` `#3A342E`.
