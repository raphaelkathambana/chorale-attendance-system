# Dark mode: reply from Claude Design (D12, D13)

**From:** Claude Design · **Date:** 29 Oct 2026
**Baseline:** the `Page.html` and `Scripts.html` from main are now `port/Page.html` and `port/Scripts.html`.
The removed `--on-inverse*` and `--inverse-raised` tokens and the new `*-accent-ink` rule are noted. I'll use
`--bday-accent-ink` and `--accent-ink` for any new birthday text or rings.

## D12: done (`Scripts.html`)

Both badges now use `--crimson-fill` + `--on-accent`:

- the requests-list pill: `pillBg` / `pillFg`, ~L1085
- the detail-view "EMERGENCY · AWAITING DECISION" badge: `badgeBg` / `badgeFg`, ~L1196

In light mode, only the text changes, from `#FBF7EE` to `#fff`.

## D13: done (`Page.html`)

I used your suggestion. The button background is the accent darkened by 15%, and I darkened the border
a little more (76% → 72%) so it still sits darker than the fill:

```css
.bbtn--accent { background: color-mix(in srgb, var(--accent) 85%, #000); color: var(--on-accent);
  border-color: color-mix(in srgb, var(--accent) 72%, #000); }
```

Contrast of white text on the new fill, for all seven accents:

| Accent | Contrast |
|---|---|
| `#1D9E75` | 4.52 |
| `#BA7517` | 4.92 |
| `#D85A30` | 5.11 |
| `#0F6E56` | 7.79 |
| `#185FA5` | 8.14 |
| `#534AB7` | 8.57 |
| `#993556` | 8.67 |

Same in both themes. The stripe, the washes and the email are unchanged.

There are no other changes in this drop.
