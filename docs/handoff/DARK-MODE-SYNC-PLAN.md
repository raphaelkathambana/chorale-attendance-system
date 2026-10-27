# Dark mode — review feedback and the sync process

**From:** Claude (backend, `Code.gs`) · **Date:** 27 Oct 2026 (rev. 2, after Design's reply)
**For:** Claude Code (the dark-mode session) and Claude Design
**Read with:** `docs/THEMING.md`, `docs/handoff/DESIGN-dark-mode.md`,
`docs/handoff/BACKEND-theme-endpoints.md`, `docs/handoff/DESIGN-reply-dark-mode.md`, and the
revised `.claude/skills/dark-mode-sync/SKILL.md` (sent alongside this file).

**Status:** Design has replied: it agrees with D1–D11, the plan and the freeze, with
corrections that are folded into this revision (§2.2, §4, §5). Still open: Raph's two decisions and
Claude Code's confirmation (§7). `THEMING (reviewed).md` is superseded by `docs/THEMING.md`.

Suggested home in the repo: `docs/handoff/DARK-MODE-SYNC-PLAN.md`.

---

## 1. Verdict

The theming system is sound and should become the foundation. Its parts:

- the theme is driven by one attribute on `<html>`
- a pre-paint script sets it before first paint
- shade tokens flip between themes and role tokens hold their job in both
- dark cards are light-token islands
- a lint catches colour literals, and a pixel-diff render proves light mode is unchanged
- the `DARK_READY` gate keeps dark mode switched off until Raph flips it

None of that needs to change. What needs fixing is **the process around it**: how new UI from Design and new backend code reach the dark-mode work, and how the result gets back to Design. Section 3 covers that, section 5 is the first sync, and section 6 is the routine afterwards.

---

## 2. Feedback on the three docs

### 2.1 `BACKEND-theme-endpoints.md` — merged, with corrections

- **Merged into the live `Code.gs` (27 Oct)**, written into the current code:
  - `theme` on every `getUserRole()` return, including the `role: "unknown"` early return
  - `getThemePreference()` and `setThemePreference(pref)`
  - storage in Script Properties under `theme_<email lowercased>`, using the active user only

  The storage decision checks out against Google's docs. `getUserProperties()` is documented as
  "only the current or effective user can access". The web app runs as the deploying account, so
  a per-email key in Script Properties is the safe choice.
- **Don't ship the branch's `Code.js`.** It was cut from the 14 Oct backend. It's missing all of
  15–26 Oct:
  - the access-control fixes
  - the double-submit guard
  - the activity log
  - communiqué drafts
  - the Phase 6 year rollover and past-year views
  - the Members-tab endpoints
  - the 26 Oct fixes (one apology per session, session PDFs and export filters, meeting edit)

  Replace the repo's `Code.js` with the current `Code.gs`. The branch's own `Code.js` diff is then
  redundant.
- **`testTheme_()` can't be run from the editor.** Functions ending in `_` don't appear in the Run
  menu. It also logged every stored theme key, which is every member's email. It's replaced by
  `testThemePreference()`: no arguments, full admins or the script owner only, and it logs only
  your own result and a count of stored keys.
- **§7 (the `getAccess_` owner fallback) is already fixed.** It was removed on 15 Oct: a blank
  email now means "unknown", which gets the access-denied screen. One part still stands. The repo's
  `appsscript.json` says `"access": "ANYONE"`, and Google defines that as "any logged-in user". The
  README says "within the domain". Google's docs don't say whether the manifest or the deployment's
  own setting wins. **Set the manifest to `"DOMAIN"`** and confirm *Deploy → Manage deployments →
  Who has access* says the same.

### 2.2 `THEMING.md` and `DESIGN-dark-mode.md` — from the backend's side

- **Rule 8 matches the backend.** These stay light:
  - **Print/PDF exports.** `buildPrintHTML_()` builds them on the server with literal colours, and
    they open as their own document. That includes the new `exportSessionPDF` and
    `exportSessionsListPDF`.
  - **Every email,** including the letterhead built by `buildEmail_()` and the birthday cards.

  Never theme any of these.
- **Server-sent colours: the birthday accents.** The seven birthday templates send a fixed `accent`
  hex to the app from three calls: `getTodaysBirthdaysForBanner()`, `getBirthdayDashboard()` and
  `getBirthdayMessageDraft()`. The accents are `#185FA5`, `#0F6E56`, `#534AB7`, `#D85A30`,
  `#993556`, `#BA7517` and `#1D9E75`.
  - They stay server-side, because they also colour the birthday email.
  - As text on dark `--surface` (`#1A1714`), four of the seven fail: `#993556` 2.55, `#534AB7`
    2.58, `#185FA5` 2.74 and `#0F6E56` 2.88 (Design's measurements).
  - **The fix is Design's spec; the sync implements it in stage 4,** since it's token-layer work and
    needs the pixel check. Add dark-only `--bday-accent-ink` / `--accent-ink` tokens:
    `color-mix(in srgb, <accent> 60%, var(--ink))`, declared on `.bday-banner` and `.bperson`. Use
    them for text, icons, avatar rings and focus borders. Keep the raw accent for fills: the
    `.bperson` stripe and `.bbtn--accent`. Every accent then measures 5.46:1 or better, and light
    mode is unchanged. The exact CSS is in `DESIGN-reply-dark-mode.md` §4.
  - **Don't change the accents in `Code.gs`.**
  - **Flagged only, outside this work:** white on `.bbtn--accent` is under 4.5:1 for `#1D9E75`,
    `#BA7517` and `#D85A30`, in both themes.
- **Nothing else server-built renders inside the app.** Every endpoint added since 14 Oct returns
  data, not HTML.
- **The backend's standing rules for dark mode:**
  - No colour logic server-side.
  - `theme` stays on every `getUserRole()` return path.
  - The `theme_` property prefix stays reserved for this feature.

---

## 3. Process gaps (the main feedback)

**G1 — A new `Code.gs` doesn't create dark-mode work.** Colour lives only in `Page.html` and
`Scripts.html`. A backend update matters to the sync in one way: new calls and return fields have to
be added to `tools/theme/fixtures.cjs`, or the screens that use them can't be rendered, so they go
unchecked. The real input to a sync is **Design's latest UI files**.

**G2 — `Code.js` will conflict on the first merge.** The branch edited the old `Code.js`, and
`main`'s new one already contains the theme functions. The current skill's conflict rule only covers
Design's markup. Rule: **`main`'s `Code.js` always wins, wholesale.** The dark-mode session never
edits `Code.js`. If the theme contract needs to change, the change goes to the backend conversation.

**G3 — Design edits its own copies, so the token work has to become Design's baseline.** Design owns
`Page.html` and `Scripts.html` and keeps working copies of its own (root and `port/`). That causes
two problems:

- **While the token work lives only on the branch,** Design keeps writing colour literals on `main`.
  Every sync re-converts every colour line Design touched, with a merge conflict on each one, and
  the syncs grow over time.
- **After a merge,** the next Design drop built from Design's pre-token copies would silently put the
  literals back. Nothing breaks visibly in light mode; dark mode just stops working on those screens.

**Fix:** sync once against current `main`, merge with `DARK_READY = false`, and have Design adopt the
merged files as its new starting point. Section 5 has the steps. After that, Design writes with
tokens and the sync becomes a safety net that only catches misses.

**G4 — Render coverage stops at 14 Oct.** `SCREENS` in `render.cjs` and the fake backend in
`fixtures.cjs` don't know about anything built since. Section 4 lists what's missing.

---

## 4. What landed on `main` after 14 Oct (the first sync's scope)

### 4.1 UI surfaces (Design, 15–26 Oct)

| Area | What's new |
|---|---|
| Notices | Duplicate-submit notices ("Already submitted…" / "Still processing…") shown as a neutral info toast; `isDuplicateNotice()` |
| Roles | View-only Super Admin: action controls hidden; communiqué screens hidden entirely |
| Communiqué | Drafts: "Save draft", saved-state line, drafts list (open/delete), conflict and "Save as new draft", missing-attachments notice |
| Activity log | New panel (full admins + Super Admin): filters, entry list; header reads `N changes · <year>` with `Newest first · showing N` |
| Members | Real attendance bars; "Show additional info" (with "Restricted" fields for section admins); server-filtered roster with a loading state |
| Attendance edit | Warning toast for skipped changes, then reload |
| Years | Year label + past-year picker; archived read-only banner; `body.year-archived` hides action controls; week/month ranges hidden in archives |
| New Year panel | Availability state, start-date field, preview summary, pending-apology cards with Approve/Reject, typed confirmation, result with archive/backup links |
| Probation | `carried` sessions marked in the bar tooltip; carryover after rollover |
| Record | Date picker `min` = current year start (`ad.min = yearInfo.currentStartsOn`) |
| Apologies | Status on the next-session card, copy from `myApologyView()`: `Apology sent · waiting for review` (or `Emergency apology sent · …`), `Apology accepted`, `Apology closed …`, `Covered by your long-term apology (…)`; picker labels + disabled "Apology on file" button; emergency route hidden when an apology exists |
| Exports | PDF button beside every CSV button; "Include" picker (Everyone · Present only · Present or late · Absent) on session, date and range exports |
| Sessions | Joint-session notice for scoped roles ("JOINT SESSION · SHOWING CHOIR ONLY") |
| Meetings | Edit form beside Delete; out-of-section groups disabled in Schedule and Edit |
| Dashboard | Group Dashboard v3 panels |

**Confirmed complete by Design** against its 26 Oct `port/` files (reply §2).

### 4.2 Calls and fields `fixtures.cjs` needs

| Call | New or changed |
|---|---|
| `getUserRole()` | `canViewPastYears`, `canStartNewYear`, `theme` |
| `getYearInfo()` | new: `{ currentLabel, currentStartsOn, nextLabel, nextStartsOn, defaultStartsOn, latestStartsOn, canStartNow, blockReason, canRollover, canViewPast, pastYears[] }` |
| `previewNewYear(startDate)` | new: plan object incl. `sheets`, `probationCarry`, `penaltiesCleared`, `auOffensesDropped`, `pendingApologiesArchived[]` (queue-card shape), `warnings`, `message` |
| `startNewYear(label, startDate)` | new: `{ success, label, previousLabel, startsOn, customStart, archiveUrl, backupUrl, summary, warnings, message }` |
| `callForYear(label, fn, args)` | new: returns `fn`'s own shape |
| `getActivityLog(filters)` | new: `{ entries[], actions[], total }` |
| `saveCommuniqueDraft`, `getCommuniqueDrafts`, `getCommuniqueDraft`, `deleteCommuniqueDraft` | new |
| `deleteCommuniqueAttachment` | `kept`, `reason` |
| `getMemberList()` | `attendanceRate`, `attended`, `totalSessions` |
| `getMemberDetails(name)` | new: details object, `redacted[]` for section admins |
| `getFilteredMemberNames(filters)` | new: `[names]` |
| `batchUpdateAttendance(updates)` | `skipped[]` |
| `getUpcomingSessions()` | `myApology` per session (`null` or `{ status, type, longTerm, startDate, endDate }`). Fixtures need one per state. Single-day: `Pending` (normal and `type: "Emergency"`), `Approved`, `Applied`, `Not needed`, `Rejected`, `Revoked`. Long-term (`longTerm: true`): `Pending`, `Approved`. These are every status the backend can return here; see §7 |
| `getProbationDashboard()` / probation stats | `sessionSequence[].carried` |
| `updateMeeting(id, changes)` | new: `{ success, id, date, time, groups, title, apologiesForOldSlot }` |
| `exportSessionPDF`, `exportSessionsListPDF` | new (print HTML; open in their own window, always light) |
| Error strings | duplicate notices start with "Already submitted" / "Still processing" |

The full shapes are in the backend's design prompts (`DESIGN_PROMPTS_Oct15.md`,
`DESIGN_PROMPTS_Oct26.md`) and in the doc comments above each function in `Code.js`.

**`SCREENS` additions, at minimum:**
- **A view-only Super Admin scenario** (`--scenario superadmin`): action controls hidden,
  communiqué hidden, activity log and past years visible
- New Year panel: before 1 Nov, available, and with pending apologies
- Past-year view: the banner, plus one dashboard and one session list
- Communiqué drafts list
- Activity log
- Member profile with additional info, as admin and as section admin
- Next-session card with an apology on file, once per `myApology` state above
- The apology picker, with a session that has an apology on file. Design could only check this
  with sample data, because its canvas boards stayed on "Loading sessions…"
- Session detail as a section admin (the joint-session notice)
- Meeting edit form

---

## 5. The first sync — step by step

| # | Owner | Step |
|---|---|---|
| 0 | **Raph** | Commit to `main`, as separate commits: (a) the current `Code.gs` as `Code.js` (`backend: 27 Oct incl. theme endpoints`); (b) Design's latest `Page.html` + `Scripts.html`, exactly what is deployed (`design: 26 Oct`); (c) `appsscript.json` access → `"DOMAIN"` if you agree with 2.1. Then tell Design **UI freeze** until step 4. |
| 1 | **Claude Code** | Run the revised `dark-mode-sync` skill (pre-merge): merge `origin/main` into the dark-mode branch. `Code.js` → take `main`'s. `Page.html` / `Scripts.html` conflicts → Design's line wins, then re-apply tokens. Lint to 0. Extend `fixtures.cjs` and `SCREENS` per section 4, including the new superadmin scenario. **Also in this sync:** delete the dead `style="color:…"` on the tally-strip `.num` span (`Scripts.html` ~L449). That's Design's reply §5; it makes no visual change. **Not in this sync:** D8 (emergency marks → `--on-accent`) and the D11 copy change, which Design does after step 4. Render admin, member, member-failed and superadmin: every light screen `light identical`. Review the dark screenshots of every new surface. Add the sync-log row. |
| 2 | **Claude Code** | Open a PR that merges the branch into `main` with `DARK_READY = false`. In the report, include the dark screenshots of the new surfaces, every rule 3 vs rule 4 call, and any new tokens. Raph merges it. |
| 3 | **Raph** | Deploy the merged files with Deploy → Manage deployments → Edit → New version. Check the app still looks exactly the same (it's light-only). Optionally preview dark on a real phone using the console key in THEMING.md. |
| 4 | **Design** | Replace its working copies (root and `port/`) with the merged `Page.html` + `Scripts.html`. This is the new baseline. **The freeze lifts here.** Design's first changes on it: D8 (the five emergency marks → `--crimson-fill` + `--on-accent`, `--on-inverse` back to dark cards only) and D11 (Appearance sub-label `Following your device · Dark` / `· Light` when System is selected). D1–D11 are already answered in `DESIGN-reply-dark-mode.md`. |
| 5 | **Claude Code** + **Raph** | Stage 4. Claude Code applies Design's birthday-accent CSS (2.2) with the pixel check, and syncs Design's D8/D11 drop. Raph does QA on a real phone in both themes, then flips `DARK_READY = true` when satisfied. |

The freeze only lasts from step 0 to step 4, normally a day. If Design must change something
urgently in that window, send it to Claude Code as a small extra commit on `main` before step 2,
rather than after.

---

## 6. The routine after the merge

### Design
- Work on the merged files. Write UI with tokens, following the cheat sheet in
  `DESIGN-dark-mode.md` §4: new dark cards are islands, email previews get `theme-light`, and
  there's no `#fff` and no literal hex.
- Hand over full `Page.html` + `Scripts.html` files as usual. In each handoff, list the **screens
  you added or changed** and the **backend calls they use**, so the sync can render them.
- Always start the next piece of work from the files the last sync handed back, not from an older
  copy.

### Raph
- Commit every drop to `main` on its own, prefixed `design:` or `backend:`. The sync log points at
  these commits.
- **Before `DARK_READY` is on**, a Design drop can be deployed straight away, because everyone sees
  light. Run the sync before the next deploy, or weekly.
- **After `DARK_READY` is on,** run the sync **before** deploying any Design drop. Otherwise new
  screens can go live unreadable in dark mode. Backend drops can deploy at any time.

### Claude Code (the sync)
- Follow the revised skill: post-merge phase, tokens only, lint `--since $LAST`, and extend fixtures
  from the `Code.js` diff.
- Render every scenario. Light must be identical and the dark screenshots must be reviewed. Add a
  row to the sync log.
- Hand back. If `Page.html` or `Scripts.html` changed, send both files to Design as its new
  baseline, with a one-line list of what changed. If nothing changed, tell Design its files are
  current.

### Backend (Claude, `Code.gs`)
- Never adds colour. Keeps `theme` on every `getUserRole()` return path.
- Every backend handoff lists the new or changed calls and return fields, as the design prompts
  already do. That list is what `fixtures.cjs` needs.
- `Code.js` on `main` is the backend's file. Theme-contract changes are requested from the backend
  conversation, not edited on a branch.

### Order of truth
`THEMING.md` holds the rules. The skill is the procedure. This file is the agreement between the
three parties. If they disagree, `THEMING.md` wins and this file gets corrected.

---

## 7. Replies wanted

- **Raph:** OK with the short UI freeze (step 0 → 4)? Set the manifest to `DOMAIN`? *(open)*
- **Design:** *(replied 27 Oct, `DESIGN-reply-dark-mode.md`)*
  - It agrees with D1–D11, confirms §4.1, will adopt the baseline, and owns the birthday spec while
    the sync implements it.
  - **One question left:** `myApology.status` can also be `Applied`, `Rejected` or `Revoked`.
    `Applied` means approved and already used to excuse a record; `Rejected` and `Revoked` mean not
    accepted. What does the card show for each? If `myApologyView()` has no case for them, the
    simplest copy is `Apology accepted` for `Applied`, and `Apology not accepted` for `Rejected`
    and `Revoked`. That's a copy decision for Design.
- **Claude Code:** confirm the revised skill, and give an estimate for steps 1–2 so Raph can time
  the freeze. *(open)*
