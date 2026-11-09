# Front end: new owner, and the 9 Nov drop

**Date:** 9 Nov 2026 · **From:** the backend conversation (Claude), for the dark-mode session and Raph

## Who owns what now

Claude Design has been retired. The backend conversation now owns `Page.html` and `Scripts.html`
as well as `Code.js`. There are no more LOGIC/RENDER prompts: one owner writes both sides.

| File | Owner | Dark-mode session |
| ------ | ------- | ----------------- |
| `Code.js`, `Page.html`, `Scripts.html` | Backend conversation | Reviews each drop before it's merged: lint, render, dark screenshots. Colour-only fixes are still welcome, as before. |
| `tools/theme/*`, `docs/THEMING.md`, the `dark-mode-sync` skill | Dark-mode session | Unchanged. This drop adds fixtures and screens (below). |

Please update THEMING.md §5 and the ownership table in the `dark-mode-sync` skill to match, and
add this drop to the §8 sync log.

The backend conversation follows THEMING.md for every UI change: tokens only, lint 0, both
themes checked with `render.cjs` before handing over.

## What's in this drop

Base: `main` @ `694a205` (PR #4).

1. **Design's last unsynced work (4 Nov).** The template name dialog stays frozen with a spinner
   while it saves, shows a refusal inside the dialog, then opens Templates with the new one marked
   "Just saved". Design built it on a timing workaround while it waited for two hook lines. The
   hooks are now in `saveCommuniqueTemplateNow()` (`commTemplateSaved(r, asNew)` on success,
   `commTemplateRefused(e)` on failure) and the workaround is gone (`showToast` and
   `paintCommTemplateStrip` no longer intercept anything).
2. **Activity log Find (backend).** A date search also matches "15 Sep 2026", "15 September 2026",
   "15/09/2026", "15/9/2026" and every entry made that day. `getActivityLog` also returns
   `actors: [{ email, name }]`, everyone in the log, so the By list is complete.
3. **Subscriptions, Stage 1 (Scripts §14, Page.html "SUBSCRIPTIONS" CSS block).**
   - Member: a Subscription card on the profile ("I've paid" with the pasted M-Pesa message,
     "Commit to pay", history with Withdraw), and a one-line reminder on My attendance while
     something is owed.
   - Subscriptions tab (`getUserRole().subscriptions.canView`): summary cards, counts by status,
     a members table with filters and CSV/PDF export, and the Treasurer panel.
   - Treasurer (`canAct`): Waiting (confirm, split, approve, reject), Record payment (M-Pesa
     message, code or cash), Reminders (preview with the real email, then send), Settings, History.
   - Full admins appoint or remove the Treasurer (up to two). A Treasurer who is an ordinary
     member gets the tab beside My attendance.
   - Past years: the tab shows the live-year-only gate (Stage 3 adds past-year subscriptions).

No new colour tokens. Every new rule uses existing tokens. Two calls you may want to check:
- `.subs-chip.t-info` (Committed) is outlined with `box-shadow: inset 0 0 0 1px var(--ink-400)`,
  the same technique as `.ny-info-mark`.
- The reminder preview is an `<iframe sandbox srcdoc>`. It's a separate document, so the email
  inside is always light (rule 8), like `openPrintHTML()`.

## Fixtures and screens added

- `fixtures.cjs`: subscription endpoints behind new state keys `subs`, `subsSetup` and `mySubs`.
  **Off by default** (no `subscriptions` caps on `getUserRole`, and `getMySubscription` throws),
  so every existing screen renders exactly as before. `getActivityLog` gains `actors`.
- `render.cjs`: 23 admin screens, 3 member screens and 2 Super Admin screens. They cover the tab
  as a viewer, a section admin, a paused Treasurer and in the set-up state, plus every Treasurer
  view and form, the five card states, both member dialogs and the My attendance line.

## Checks run

- `lint.cjs --summary`: 0 literals, 0 judgment calls.
- `render.cjs`, all four scenarios against `origin/main` @ `694a205`: every existing screen is
  light-identical (admin 88, member 17, member-failed 3, superadmin 13). The only differences
  are the 28 new Subscriptions screens, which `main` doesn't have. The template screens are
  identical too: Design's dialog changes only show while a save is running.
- An end-to-end run of the real page against the real `Code.js` in the backend test harness
  passed all 31 checks. It covers setup, paying, committing, withdrawing, splitting, approving,
  recording cash, the reminder preview, appointing, and the section admin's scope.
