# Theming — light & dark mode

**Audience:** anyone editing `Page.html` or `Scripts.html` (Claude Design), and anyone adding the
preference endpoints to `Code.gs`. Read this before changing any colour.

**Status:** in progress on branch `claude/awesome-sagan-63z5lj`. This file is the contract; the
token block in `Page.html` `:root` is the implementation. If the two disagree, fix one of them —
don't fork the rules.

| Rollout step (§7) | State |
| ------------------- | ------- |
| 1 · Tokens + plumbing | **Done.** Tokens (light + dark), `.theme-light`, the pre-paint script with `window.ScTheme`, `theme` on `getUserRole()`, `get/setThemePreference()`, and the Appearance row on My Profile. Light mode is pixel-identical to `main` on all 12 screens tested (6 tabs at 390 px and 1440 px). |
| 2 · Page.html sweep | **Done.** 0 colour literals left in `Page.html` (`lint.cjs`). Rule 4 is now implemented as light-token islands (see the rule). Light mode is pixel-identical to `main` on 24 renders (12 screens × phone/desktop), apart from the accepted §3a chip. |
| 3 · Scripts.html sweep | **Done.** 0 colour literals in either file (`lint.cjs`). Section tints, the trend chart, badges and surfaces are on tokens. The two generated dark cards (By-member stat card, post-save tally) carry `class="theme-inverse"`. The welcome-email preview's header and body carry `class="theme-light"`, and the signature palette has an allow marker. Dark `--crimson-600` lightened for legibility (§6). Light mode is pixel-identical to `main` on 44 renders (3 scenarios, 22 screens, phone and desktop). |
| 4 · QA + switch on | **Next.** Plan §5 step 3 onwards: deploy the merged files (light-only), Design adopts them as its baseline and makes D8 + D11, then the birthday-accent CSS (plan §2.2) with the pixel check, real-device QA, and `DARK_READY = true`. |

**Handoff notes:** `docs/handoff/DESIGN-dark-mode.md` (decisions D1–D11 for Claude Design to
respond to, components, changelog) and `docs/handoff/BACKEND-theme-endpoints.md` (the `Code.gs`
contract).

**The rollout gate.** `DARK_READY` in the boot script at the top of `Page.html` is `false`, so
everyone gets light, whatever their device or saved preference, and the Appearance row is hidden.
Step 4 flips it to `true`. To preview dark mode before then, run this in the browser console
(app frame selected), then reload:
`localStorage.setItem("sc-theme-preview", "1")`. Remove the key to go back.

## Review changes (summary)

1. **Theme travels in `getUserRole()`**, not a separate first-load call (§1).
2. **Filled-control tokens added** — a single `--on-accent` breaks in dark mode (§2a).
3. **Active segment / toggle buttons use `--surface`, not `--paper`** (§3a).
4. **Missing role tokens added** for literals the audit found (§2b).
5. **Concrete dark values** supplied (§6).
6. **Phased rollout + lint** so a 600 KB sweep doesn't land as one diff (§7).

## Review round 2 (code side) — checked against `main` @ `3411714`

1. **Storage fixed — `getUserProperties()` would share one theme across everyone.** The web app
   runs `executeAs: USER_DEPLOYING`, so user properties belong to the deploying account, not the
   visitor. Theme is stored in Script Properties keyed by email instead (§1).
2. **§3a token fixed.** Dark `--surface` (`#1A1714`) is *darker* than the `--paper-100` track
   (`#211D19`), so a `--surface` chip still looks sunken. New `--seg-active` token (§3a).
3. **Alpha washes keep their alpha.** Page.html has ~15 distinct shadow / wash alphas; collapsing
   them into `--shadow-1/2` breaks rollout step 1's "pixel-identical". RGB-triplet tokens fix
   that (§2c).
4. **`--absent-unexc` dark nudged** to `#E8666E`: `#E04D56` on its bg is 4.28:1, under 4.5 for
   the small mono pill text (now 5.23:1). Contrast notes corrected with measured values (§6).
5. **Lint fixed.** `\bwhite\b` matches `white-space` (25 hits, all false), so the check could
   never come back clean (§7).
6. **Line numbers refreshed** to `main` @ `3411714`; they were 40–80 lines off. Where possible,
   rules now name the function instead.

---

## 1. How the theme is chosen

- `<html>` always carries `data-theme="light"` or `data-theme="dark"`. CSS only ever reads that
  attribute — there is **no** `@media (prefers-color-scheme)` block in the stylesheet.
- The member picks **System / Light / Dark** (stored as `"system" | "light" | "dark"`).
  Default is `"system"`. When it is `"system"`, the client resolves it with
  `matchMedia('(prefers-color-scheme: dark)')` and keeps listening, so the app follows the device
  live.
- A tiny inline script, **the first thing in `<head>`**, sets `data-theme` and
  `document.documentElement.style.colorScheme` before first paint (from a `localStorage` hint,
  falling back to the system setting) so the page never flashes light and native controls match
  before CSS loads.
- The preference itself lives server-side, per Google account, so it follows the member across
  devices:

  | Owner | Function | Returns |
  | ------- | ---------- | --------- |
  | `Code.gs` | `getUserRole()` | existing object, plus `theme: "system" \| "light" \| "dark"` |
  | `Code.gs` | `getThemePreference()` | `"system" \| "light" \| "dark"` (default `"system"`) |
  | `Code.gs` | `setThemePreference(pref)` | `{ success, theme }` — rejects anything outside the three values |

- **Storage:** Script Properties, key `theme_<email lowercased>` — the same pattern as the
  existing `bdsent_<year>_<email>` keys. **Not** `getUserProperties()`: the web app runs as
  `USER_DEPLOYING`, so user properties belong to the deploying account and every visitor would
  share one theme. The email comes from the same resolution `getAccess_()` uses, so superAdmin
  and other non-member accounts work too.

- **Load path:** the client applies `getUserRole().theme` in the same callback that boots the app.
  `getThemePreference()` can exist, but the client must **not** call it on load — every extra
  `google.script.run` round trip is ~300–800 ms.
- **localStorage hint** (key `sc-theme`): the app runs in a sandboxed
  `*.googleusercontent.com` iframe, so storage can be partitioned or blocked (Safari, some in-app
  browsers). Wrap every read/write in `try/catch` and fall back to `matchMedia`.
- When the server value arrives and differs from the hint, apply it and update the hint. No
  transition on that swap (add `transition` to theme-sensitive props only after first paint, or
  not at all).

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
| ------- | ----- | ---------- |
| `--surface` | Card / sheet / input background that sits on the page | `#fff`, `#FFF`, `white`, `--card` |
| `--surface-sunk` | Recessed well inside a surface | ad-hoc `--paper-100` wells (optional) |
| `--inverse` | **Dark card** background: dark in light mode, *raised* (lighter than the page) in dark mode, see rule 4 and §4a | `background: var(--ink)` on cards |
| `--inverse-raised` | A tile or row inside a dark card | `rgba(243,233,206,0.0x)` washes |
| `--on-inverse` | Main text on a dark card | `color: var(--paper)` on cards |
| `--on-inverse-muted` | Secondary text / labels on a dark card | `--ink-300`/`--ink-400` on cards |
| `--on-inverse-line` | Dividers & borders on a dark card | `rgba(243,233,206,0.15–0.22)` |
| `--on-inverse-accent` | Gold on a dark card | `--gold-300` / `--gold-500` on cards |
| `--on-accent` | Text/icons on a filled gold, crimson or green control (white in both themes) | `color: #fff` |
| `--shadow-1`, `--shadow-2` | Small / large elevation | `rgba(20,17,15,…)` box-shadows |
| `--scrim` | Backdrop behind dialogs & sheets | `rgba(43,38,32,…)` overlays |

`--card` stays as an alias of `--surface` so old code keeps working; new code uses `--surface`.

## 2c. Alpha washes — RGB-triplet tokens

`rgba()` washes and shadows keep their own alpha at the call site and take the colour from a
triplet token:

```css
box-shadow: 0 10px 26px rgba(var(--shadow-rgb), 0.3);
background: rgba(var(--gold-rgb), 0.10);
```

| Token | Light | Dark | Replaces |
| ------- | ------- | ------ | ---------- |
| `--shadow-rgb` | `20,17,15` | `0,0,0` | `rgba(20,17,15,…)` and `rgba(43,38,32,…)` shadows |
| `--scrim-rgb` | `43,38,32` | `0,0,0` | dialog / sheet backdrops |
| `--gold-rgb` | `176,133,56` | `201,166,88` | gold washes and focus rings |
| `--on-inverse-rgb` | `243,233,206` | `237,232,221` | washes and lines inside dark cards |
| `--present-rgb` | `74,124,89` | `109,181,123` | green washes |
| `--crimson-rgb` | `182,32,42` | `224,77,86` | crimson washes (e.g. the down-trend tag) |
| `--paper-rgb` | `251,247,238` | `20,18,16` | paper-coloured washes that should flip (text on probation-bar segments, spinner track) |

`--scrim-rgb` (`43,38,32`) is also used for the few shadows built on that colour, so their light
pixels stay unchanged.

This keeps light mode pixel-identical (every alpha is unchanged) without a token per alpha.
Shadows on a dark page read weaker. If one needs more weight in dark mode, raise that call site's
alpha under `:root[data-theme="dark"]`. Don't add a new shadow token.
The named tokens (`--shadow-1`, `--shadow-2`, `--scrim`, `--focus-ring`, `--inverse-raised`,
`--on-inverse-line`) stay as shorthands for **new** code, defined in terms of the triplets.
`rgba(var(--…-rgb), a)` is the only `rgba(` form the lint allows.

## 2a. Filled controls — fill tokens

In dark mode `--gold`, `--crimson`, `--present` etc. are **lightened** for text legibility. White
text on those lighter fills drops below 3:1. The status-button rules
(`.status-primary button.active-p`, `.status-five button.act-*`, `.status-sub button.active-*`),
`.btn-gold`, `.btn-crimson`, `.btn-green`, `.toast.*`, `.dialog-actions .btn-danger`,
`.changes-actions .btn-save` all fill with a fg token today.

Add a **fill** token per accent. Fills stay mid-tone in both themes; `--on-accent` stays white in
both themes.

| Token | Use for |
| ------- | --------- |
| `--gold-fill`, `--crimson-fill` | `.btn-gold`, `.btn-crimson`, `.btn-danger`, `.btn-save`, badges with white text |
| `--present-fill`, `--late-exc-fill`, `--late-unexc-fill`, `--absent-exc-fill`, `--absent-unexc-fill` | Active P/L/A and 5-way status buttons, `.toast.success/.error` |
| `--present-fill-hover` | replaces `#3E6A4A` in `.btn-green` |

Rule: **fg tokens are for text and strokes; `*-fill` tokens are for backgrounds under
`--on-accent`.** Never put `--on-accent` on a fg token.

## 2b. Additional role tokens (from the literal audit)

| Token | Replaces | Where |
| ------- | ---------- | ------- |
| `--tint-soprano`, `--tint-alto`, `--tint-tenor`, `--tint-bass` | `#F3E9CE`, `#F0E0CE`, `#ECE7DE`, `#E1ECDF` | `Scripts.html` ~L1469, ~L4081 (section avatar tints) |
| `--tint-choir`, `--tint-band`, `--tint-orchestra` | same hexes | `Scripts.html` ~L846, ~L4082 |
| `--medal-silver`, `--medal-silver-ink`, `--medal-bronze` | `#A9A39A`, `#7E7972`, `#A56A3A` | `.podium-col.silver/.bronze` |
| `--on-inverse-ok`, `--on-inverse-bad` | `#A6D7B4`, `#E8A6AB` | `.trend-tip .tip-p/.tip-au`, `.apol-cell .num.ok/.bad`, `.dash-hero-delta .tag.down` |
| `--crimson-wash` | `#F1D6D2` | `.apology-queue-item.emergency:hover/.selected` |
| `--switch-on` | `#2A7D52` | `.bswitch[aria-checked="true"]` |
| `--warning-fill` | `#8E6A2A` | `.toast.warning` (white text on it, 4.9:1). The same value in both themes, like the other fills. |
| `--present-line` | `#C7DBC4` | Green border on a `--present-bg` panel (`.ny-done`). Dark value `#2F4F36`. |
| `--success` | `#2A7D52` | Birthday "sent" text and chip (`.bperson__sent`, `.bperson__auto`). Dark value `#4FAE7C` (6.5:1 on `--surface`). |
| `--focus-ring` | `rgba(176,133,56,0.10–0.25)` | `.needs-attention`, `:focus` box-shadows in communiqué. Existing call sites use `rgba(var(--gold-rgb), a)` (§2c) to keep their alphas. |
| `--chart-grid`, `--chart-label`, `--chart-line`, `--chart-dot-ring`, `--chart-value` | `#E8DEC6`, `#8C8478`, `#B08538`, `#FBF7EE`, `#14110F` | Trend SVG in `Scripts.html` (the trend renderer, ~L4662–4683) and the static one in `Page.html` ~L2036–2048. Gradient `stop-color` must also move to `style="stop-color:var(--chart-line)"`. `.trend-card` sits on `--paper`, so `--chart-dot-ring` must always equal `--paper`. |
| `--seg-active` | `#fff` | Active chip of a segmented toggle (§3a) |

`.bbtn--accent { border-color: color-mix(in srgb, var(--accent) 76%, #000) }` is allowed — `#000`
inside `color-mix` as a darkening operand is the one permitted literal.

## 3. Rules

1. **No colour literals in UI code.** No hex, `rgb()`/`rgba()` or named colours in `Page.html`
   CSS, in inline `style="…"`, or in HTML strings built by `Scripts.html`. Every colour is a
   `var(--…)`. The only exceptions are listed in rule 8.
2. **Text, borders, quiet fills:** keep using the shade tokens exactly as today
   (`--ink`, `--ink-500`, `--paper-100`, `--paper-200` …). They flip for you.
3. **Selected / primary states invert — and that's correct.** `.btn-primary`, `.chip.active`,
   `.nav-item.active`, checked checkboxes: keep `background: var(--ink); color: var(--paper)`.
   In dark mode they become a light pill with dark text, which is the intended inverted look.
   Segmented toggles are the exception — see §3a.
4. **Dark cards stay dark: they are light-token islands.** Hero cards and strips that are dark
   *by design* look the same in both themes. In dark mode every token inside them keeps its
   **light** value, so a dark card's content is written exactly as in light mode
   (`color: var(--paper)`, `var(--gold-300)`, `rgba(var(--on-inverse-rgb), .18)` …). Two things
   make a card an island:
   - its background is `var(--inverse)`, not `var(--ink)`. `--inverse` is the one token an island
     doesn't reset, so the card lifts off the dark page (§4a);
   - its selector is in the island list in the `Page.html` token header (`:root[data-theme="dark"]
     :is(…)`), or the element has `class="theme-inverse"`. Use the class for dark cards built
     with inline styles in `Scripts.html`.

   Islands today: `.card-dark`, `.dash-hero`, `.sess-tally`, `.tally-strip`, `.apol-strip`,
   `.trend-tip`, `.podium-block`, `.changes-bar`, `.hero-rank`, the meeting `.type-badge`,
   `.dash-busy-pill` (not its `.dash-busy-wait` variant), the failed-probation badge; and since the
   `17bab8d` sync, the archived-year banner `.yr-banner` and the ink-and-gold badges `.yr-due-tag`,
   `.yr-past-viewing`, `.ny-pending-n`, `.act-badge.t-ink`, `.act-av.is-system`,
   `.cds-tag:not(.is-copy)`, `.draft-here`. Generated
   with `class="theme-inverse"`: the By-member stat card (`renderMemberHistory`) and the
   post-save tally (`showPostSubmit`).
   Quick test: *"Should this be dark even in light mode?"* Yes → island. It's a selected state
   → rule 3.
   *Why islands instead of `--on-inverse-*` everywhere (the earlier draft of this rule):* dark
   cards use half a dozen shades for their content. Mapping each to an `--on-inverse-*` token
   whose light value matches the shade exactly would need a token per shade. Islands keep light
   mode pixel-identical with no new tokens, and Design writes dark cards the way it always has.
   The `--on-inverse-*` tokens still exist for **light text on a colour fill outside a card**,
   e.g. the crimson emergency marks (`--crimson-fill` + `--on-inverse`).
5. **Surfaces are `--surface`, never white.** Text on a filled gold/crimson/green button is
   `--on-accent`, never `#fff`, and the fill is a `*-fill` token (§2a), never a fg token.
6. **Status colours always travel as a pair.** `--absent-unexc` text sits on
   `--absent-unexc-bg`, etc. Never put a status fg on a hand-picked background.
7. **SVG colours go through CSS.** Chart lines, dots, grid and labels use
   `style="stroke:var(--…)"` / `style="fill:var(--…)"` or a class — not `stroke="#B08538"`.
   (`var()` is not reliable inside SVG presentation attributes.)
8. **Things that never theme:**
   - Email templates (`EmailLayout.html`, `SignatureFooter.html`, `welcome-invite.html`, …) and
     the communiqué signature block (`commSignatureBlock()`): they render in the recipient's inbox.
   - **In-app previews of emails** render as the inbox shows them in both themes, while the
     preview chrome around them (the "live preview" bar) stays themed. The email parts are
     light-token islands: `class="theme-light"` on the welcome-email header and body
     (`renderAddMemberPreview`), and `#communiquePreview .cp-sheet` (in the `Page.html` island
     list) for the communiqué letterhead. Inside them use tokens as usual: `--surface` is white
     and `--ink` is dark there. Light islands also reset `color`, because inherited text colour
     doesn't re-resolve. The signature palette (`var BL=…` in `commSignatureBlock()`) is the
     email's brand colours and carries a `theme-lint: allow` marker.
   - Print / PDF windows (`openPrintHTML()`): separate document, always light.
   - Member photos and the gold logo images.
9. **Native controls follow the theme.** `color-scheme` is set on `:root` per theme so date
   pickers, selects, scrollbars and autofill go dark too. Don't override it on individual inputs.
10. **New colour need?** Add a token to `:root` **and** its dark value under
    `:root[data-theme="dark"]` in the same edit, then use it. A token with only a light value is a
    bug.

## 3a. Rule 3 amendment — segmented toggles

`.view-mode-toggle button.active`, `.seg-control button.active`, `.comm-subtab.is-active`,
`.comm-mode-btn.is-active` use a light chip on a `--paper-100` track. In dark mode `--paper` is
*darker* than `--paper-100`, so the active chip would look sunken. `--surface` doesn't fix it
either: dark `--surface` (`#1A1714`) is also darker than the dark track (`#211D19`). Use
**`--seg-active`** + `--shadow-1` for these "raised chip" actives. It's `#fff` in light and
`#3A342E` in dark, which separates from the track by 1.36:1, more than light mode's 1.18:1.
Light-mode note: `.view-mode-toggle` and `.seg-control` change from `--paper` to `#fff`. That's
barely visible, and it's the one accepted light-mode change in rollout step 1. Rule 3 (ink/paper inversion) still applies to `.btn-primary`,
`.chip.active`, `.nav-item.active` and checkboxes.

## 4. Before handing back a UI change

- Flip the theme (the Appearance control, `ScTheme.use("dark")` in the console, or the preview key
  above while the gate is closed) and look at every screen you touched.
- Run `node tools/theme/lint.cjs --since <last commit>`: no new literals, and every judgment call
  decided (rule 1, §7a).
- Dark cards: still dark in light mode, still readable in dark mode — rule 4.
- Status pills, the probation bars and the trend chart read clearly in both.

## 4a. Dark cards in dark mode

`--inverse` in dark mode is **raised** (`#26211C`, lighter than the `#141210` page), not darker: a
card the same colour as the page disappears. `--inverse` is declared in its own `:root` rule,
outside the light-token block, so islands inherit the page's value instead of resetting it.
At `#26211C` the cards separate from the page without a border, so none is added. A border would
also shift layout by a pixel in light mode. If a card ever needs more separation in dark mode,
use `outline` (no layout effect), not `border`.

## 5. Ownership

| File | Owner | Theming responsibility |
| ------ | ------- | ------------------------ |
| `Page.html` | Claude Design | Token block (light + dark), every CSS rule follows §3 |
| `Scripts.html` | Claude Design | Generated HTML follows §3; Appearance control; applies `getUserRole().theme` and resolves `system`; calls `setThemePreference()` |
| `Code.gs` | Claude (code) | `theme` field on `getUserRole()`, `getThemePreference()` / `setThemePreference()` — no colour lives server-side |
| Email templates | — | Out of scope: never themed |

## 6. Values

Light values are today's `:root`. Dark values:

```
:root[data-theme="dark"]{color-scheme:dark;
--ink:#EDE8DD;--ink-700:#D6CFC1;--ink-600:#B5AC9D;--ink-500:#8C8478;--ink-400:#6B6058;--ink-300:#504840;--ink-200:#3A342E;
--paper:#141210;--paper-100:#211D19;--paper-200:#2E2924;--paper-300:#403A33;
--surface:#1A1714;--surface-sunk:#100E0C;--card:var(--surface);
--gold:#C9A658;--gold-700:#D9BC72;--gold-500:#B39350;--gold-300:#5E4E25;--gold-100:#2A2316;
--crimson:#E04D56;--crimson-600:#EC7078;--crimson-500:#E8666E;--crimson-100:#2E1719;
--present:#6DB57B;--present-bg:#172A1C;
--late-exc:#C9A658;--late-exc-bg:#2A2316;
--late-unexc:#D9934A;--late-unexc-bg:#2B2015;
--absent-exc:#A0968A;--absent-exc-bg:#28241F;
--absent-unexc:#E8666E;--absent-unexc-bg:#2E1719;
--seg-active:#3A342E;
--shadow-rgb:0,0,0;--scrim-rgb:0,0,0;--gold-rgb:201,166,88;--on-inverse-rgb:237,232,221;--present-rgb:109,181,123;
--gold-fill:#A07A32;--crimson-fill:#B6202A;
--present-fill:#467654;--present-fill-hover:#3E6A4A;--late-exc-fill:#A07A32;--late-unexc-fill:#B36B2B;--absent-exc-fill:#6E6458;--absent-unexc-fill:#B6202A;
--on-accent:#FFFFFF;
--inverse:#26211C;--inverse-raised:rgba(237,232,221,0.06);
--on-inverse:#EDE8DD;--on-inverse-muted:#A39A8C;--on-inverse-line:rgba(237,232,221,0.12);--on-inverse-accent:#D9BC72;
--on-inverse-ok:#A6D7B4;--on-inverse-bad:#E8A6AB;
--tint-soprano:#302818;--tint-alto:#302218;--tint-tenor:#2A2820;--tint-bass:#1E2A20;
--tint-choir:#302818;--tint-band:#302218;--tint-orchestra:#1E2A20;
--medal-silver:#B5AFA6;--medal-silver-ink:#B5AFA6;--medal-bronze:#C08050;
--crimson-wash:#3A1C1E;--switch-on:#3C9A68;--focus-ring:rgba(201,166,88,0.30);
--chart-grid:#2E2924;--chart-label:#8C8478;--chart-line:#C9A658;--chart-dot-ring:#141210;--chart-value:#EDE8DD;
--shadow-1:0 1px 2px rgba(0,0,0,0.4);--shadow-2:0 16px 40px rgba(0,0,0,0.55);--scrim:rgba(0,0,0,0.6);}
```

Light-mode values for the new tokens: `--surface:#fff; --surface-sunk:var(--paper-100);`
`--gold-fill:#B08538; --crimson-fill:#B6202A; --present-fill:#4A7C59; --present-fill-hover:#3E6A4A;`
`--late-exc-fill:#B08538; --late-unexc-fill:#C57730; --absent-exc-fill:#7A6F62; --absent-unexc-fill:#B6202A;`
`--on-accent:#fff; --inverse:#14110F; --inverse-raised:rgba(243,233,206,0.08);`
`--on-inverse:#FBF7EE; --on-inverse-muted:#B5AC9D; --on-inverse-line:rgba(243,233,206,0.18); --on-inverse-accent:#E2C988;`
`--on-inverse-ok:#A6D7B4; --on-inverse-bad:#E8A6AB;` tints/medals/wash/switch/chart = current literals;
`--focus-ring:rgba(176,133,56,0.18); --shadow-1:0 1px 2px rgba(20,17,15,0.06); --shadow-2:0 16px 40px rgba(20,17,15,0.32); --scrim:rgba(20,17,15,0.45);`

`--seg-active:#fff;` plus the light triplets in §2c.

Added in stage 2. Light: `--crimson-rgb:182,32,42; --paper-rgb:251,247,238; --success:#2A7D52`.
Added in the `17bab8d` sync. Light: `--warning-fill:#8E6A2A; --present-line:#C7DBC4`. Dark:
`--warning-fill:#8E6A2A; --present-line:#2F4F36`.
Dark: `--crimson-rgb:224,77,86; --paper-rgb:20,18,16; --success:#4FAE7C`.

The light block is shared by `.theme-light`, `#communiquePreview .cp-sheet` and the dark-card
islands (rule 4), so all of them get every light value plus `color-scheme:light` automatically.
`--inverse` is the exception, declared in its own `:root` rule (§4a).

Contrast (measured, WCAG 2.x):

| Pair | Light | Dark |
| ------ | ------- | ------ |
| `--ink-500` on `--paper` | 5.71 | 5.06 |
| `--ink-400` on `--paper` (muted / disabled only) | 3.45 | 3.06 |
| `--ink-400` on `--paper-100` | 3.14 | 2.74 ⚠ (muted only, never body text) |
| white on `--gold-fill` | 3.36 | 3.94 (pre-existing: large / bold text only) |
| white on `--late-unexc-fill` | 3.47 | 4.15 |
| white on `--present-fill` / `--absent-exc-fill` / `--crimson-fill` | 4.86 / 4.91 / 6.5 | 5.28 / 5.79 / 6.50 |
| `--absent-unexc` on `--absent-unexc-bg` | — | 5.23 (was 4.28 with `#E04D56`) |
| other status fg on bg | — | 5.3–6.7 |
| `--on-inverse-muted` on `--inverse` | — | 5.74 |
| `--crimson-600` text on `--crimson-100` / `--paper` / `--crimson-wash` | 6.58 (on `-100`) | 5.71 / 6.37 / 5.24. Was 3.26 / 3.63 / 2.99 with `#CF2D37`; changed in stage 3. Like `--gold-700`, the text shade must be the *lighter* one in dark mode. |

## 7. Rollout

1. **Tokens + plumbing** — dark block, new tokens at light values, pre-paint script,
   `getUserRole().theme`, `setThemePreference`, Appearance row. Ship with the Appearance row
   hidden. Light mode must be pixel-identical, except the §3a segmented-toggle chip.
2. **Page.html sweep** — ~120 hex, ~37 rgba, ~24 `#fff/white` literals; ~24
   `background:var(--ink)` and ~36 `color:var(--paper)` that need the rule-3-vs-rule-4 call.
3. **Scripts.html sweep** — ~22 literal lines (list in §2b), plus every generated
   `background:var(--ink)` (6) / `color:var(--paper)` (11) checked against rule 4.
4. **QA** — unhide Appearance. Check every role's port preview in both themes. Also check the
   birthday colourways: their `--bday-accent` / `--accent` values are fixed hexes mixed with
   `--paper` via `color-mix`, so the mixes go dark automatically. The white text on
   `.bbtn--accent` still needs checking against each of the 7 accents.

## 7a. Tools

Dev-only tooling in `tools/theme/`. These are `.cjs` files, so `clasp push` never uploads them.

| Command | Checks |
| --------- | -------- |
| `node tools/theme/lint.cjs` | Colour literals outside allowed regions (rule 1). Exit 1 if any. `--summary` for counts. |
| `node tools/theme/lint.cjs --since <sha>` | Literals on lines added since `<sha>`, plus the judgment calls (rules 3–5, §3a). |
| `node tools/theme/render.cjs [--scenario admin\|member\|member-failed\|superadmin]` | Light pixel-identical to `origin/main` (admin 29 screens, member 13, member-failed 3, superadmin 13; phone and desktop). Screens can set fixture state (role, year, `myApology`) and boot fresh; any screen still on a spinner or "Loading…" is reported, the `DARK_READY` gate holds, and dark screenshots for review. |

**Allowed regions** are marked in the source rather than listed in the tool, so they move with
the code: `theme-lint: off` … `theme-lint: on` around a block, or `theme-lint: allow` on one
line. Use them only for the token blocks and rule 8 exceptions.

`tools/theme/accepted-light-changes.css` lists light-mode changes this work makes on purpose
(e.g. §3a). The render check applies it to the `main` render before comparing. Empty it once
dark mode is merged into `main`.

Lint baseline (`lint.cjs --summary`): `main` @ `8ea7d54` with the stage 1 token blocks unmarked
had Page.html 216 hex + 37 rgb and Scripts.html 39 hex. After stage 2: **Page.html 0**,
Scripts.html 39. After stage 3: **0 in both files.** From here, any hit is new UI. The lint also flags a token defined as itself (`--x: var(--x)`), which is a
cycle that silently invalidates the colour; a find-and-replace can introduce one.

## 8. Sync log

New UI keeps landing on `main` without dark-mode support. The procedure for catching up is the
`dark-mode-sync` skill (`.claude/skills/dark-mode-sync/SKILL.md`). Each sync adds a row here; the
newest row's commit is `$LAST` for the next sync.

| Date | `main` commit synced | New on main | Notes / judgment calls |
| ------ | ---------------------- | ------------- | ------------------------ |
| 2026-10-14 | `8ea7d54` | Emergency apology expiry, sessions loading state, button states, member roster styling | Stage 1 only: tokens and plumbing, no sweep yet. Lines added in `8ea7d54` are covered by the stage 2–3 sweep. |
| 2026-10-26 | `8ea7d54` | (no new commits) | Stages 2–3 complete: all UI on `main` up to `8ea7d54` is covered, including the crimson emergency marks and member-roster styling added in that commit. Calls: dark cards → islands (rule 4 rewrite); crimson marks → `--crimson-fill` + `--on-inverse`; email previews → light islands; dark `--crimson-600` → `#EC7078`. |
| 2026-10-27 | `17bab8d` | Phase 5 and 6 (Design 15–26 Oct, backend 27 Oct): duplicate-submit and partial-save toasts, chorale years (year switch, archived banner, years page, New Year panel), activity log, communiqué drafts, member additional info with restricted fields, joint-session notice, meeting edit, next-session apology status, export PDFs. | `Code.js` taken from `main` wholesale. 14 literals and 31 judgment calls in Design's new lines. **Rule 4 (islands):** `.yr-banner` and the ink-and-gold badges `.yr-due-tag`, `.yr-past-viewing`, `.ny-pending-n`, `.act-badge.t-ink`, `.act-av.is-system`, `.cds-tag:not(.is-copy)`, `.draft-here`. **Rule 3 (invert):** `.toast.info`, `.btn-export.cdc-strong`; status dots keep their fg colours. Active items in the year and people popovers → `--seg-active`. New tokens `--warning-fill`, `--present-line`. Dead tally-strip `.num` colour removed (Design reply §5). Fixtures: years, New Year plan, activity log, drafts, member details (+ section-admin redaction), meeting update, `myApology` (9 states), `carried` probation sessions, `callForYear`. Screens: +13 admin, +10 member, new superadmin scenario (13). Not in this sync: D8, D11, birthday accents. |
