# Dark mode — reply from Claude Design (post-merge)

**From:** Claude Design · **Date:** 28 Oct 2026
**Baseline:** the merged `Page.html` + `Scripts.html`, adopted as `port/Page.html` and `port/Scripts.html`.
Freeze acknowledged as lifted.
**Root copies:** there are no root copies of `Page.html` or `Scripts.html` in this project; `port/` is
the only place they live.

## 1. D8: done

The five emergency marks now use `--crimson-fill` + `--on-accent`: `.em-tag`, `.em-callout-mark`,
`.req-emergency-count`, `.em-door-mark` and `.apol-emhint-mark`.

- **Light mode:** the only visible change is `#FBF7EE` → `#fff` on those marks.
- **Unused token:** `Page.html` now has no `var(--on-inverse)` left. Dark cards get their light
  values through the light-token island and never read `--on-inverse`. Remove it from the
  token blocks and `THEMING.md`, or keep it reserved for dark cards; your call.

## 2. D11: done

When **System** is selected, the Appearance sub-label reads `Following your device · Dark` (or
`· Light`), using `ScTheme.resolved()`. Light and Dark still say `Saved to your account`.

A `matchMedia` listener in `Scripts.html`, just after `refreshAppearanceRow()`, redraws the
label when the operating system's theme changes. It is registered after the theme boot's own
listener, so `resolved()` already holds the new value when it runs.

## 3. Card wording: Applied, Rejected, Revoked

These are set in `myApologyView()`, which drives the card, the picker and the apology page.

| Status | Title | Body | Tone |
|---|---|---|---|
| Approved / Accepted | Apology accepted | none | ok |
| **Applied** | **Apology accepted · marked excused** | none | ok |
| **Rejected** (and Expired / anything else) | Apology not accepted | Another one can’t be sent for this session. Speak to your section admin if you think that’s wrong. | no |
| **Revoked** | **Apology withdrawn** | An admin withdrew it after accepting it, so it no longer excuses this session. Another one can’t be sent. Speak to your section admin if you think that’s wrong. | no |

`short` for Revoked is `apology withdrawn`. Rejected wording is unchanged.

**Why:**

- **Applied:** the attendance has been saved as excused. Saying so tells the member the apology
  took effect, not just that an admin approved it.
- **Revoked:** the member saw "accepted" before. "Not accepted" would read like a contradiction;
  "withdrawn" says what changed.

The body doesn't say "counts as unexcused": if a single-day apology is revoked before
attendance is taken and the member then attends, they're Present.

**Backend follow-up:** `Code.gs` ~L9270 falls through to "was not accepted" for `Revoked`. To
match, add `case "Revoked": return "Your apology for this session was withdrawn, so another one
can't be sent. Speak to your section admin if you think that's wrong.";`

## 4. Fixtures to add

For `myApology`: `Applied` and `Revoked`, alongside the existing `Pending`, `Approved`,
`Not needed` and long-term pending and accepted.
