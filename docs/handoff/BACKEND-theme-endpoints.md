# Dark mode — backend changes to `Code.gs`

**From:** Claude Code · **Branch:** `claude/awesome-sagan-63z5lj` (commit `8019daa`) ·
**For:** the agent that maintains `Code.gs` (`Code.js` in the repo).
**Rules for the whole feature:** `docs/THEMING.md` §1 and §5.

The backend part of dark mode is small: one field on `getUserRole()`, and two endpoints that read
and save each person's appearance preference. No colour lives server-side, and no email template
changed.

---

## 1. What changed

| Where | Change |
| ------- | -------- |
| `getUserRole()` (~L481) | Both return paths now include `theme: readThemePreference_()`: the early `role: "unknown"` return and the main `out` object. `removed` returns `out`, so it has it too. |
| New section `// ── Appearance (light / dark theme)` (~L530–571), between `getUserRole()` and `findMemberByEmail_()` | `THEME_PREFERENCES`, `themeKey_()`, `activeEmailForTheme_()`, `readThemePreference_()`, `getThemePreference()`, `setThemePreference(pref)`. |

Nothing else in `Code.js` changed. The diff is +44 / −2 lines.

```js
var THEME_PREFERENCES = ["system", "light", "dark"];

function themeKey_(email) {                       // "theme_" + lower-cased email
  return "theme_" + String(email).trim().toLowerCase();
}
function activeEmailForTheme_() {                 // active user only, never the effective user
  try { return Session.getActiveUser().getEmail() || ""; } catch (e) { return ""; }
}
function readThemePreference_() {                 // never throws; "system" on anything unexpected
  var email = activeEmailForTheme_();
  if (!email) return "system";
  try {
    var v = PropertiesService.getScriptProperties().getProperty(themeKey_(email));
    return THEME_PREFERENCES.indexOf(v) !== -1 ? v : "system";
  } catch (e) { return "system"; }
}
function getThemePreference() { return readThemePreference_(); }
function setThemePreference(pref) {               // throws on a bad value or no email
  pref = String(pref || "").toLowerCase();
  if (THEME_PREFERENCES.indexOf(pref) === -1) throw new Error("Unknown theme: " + pref);
  var email = activeEmailForTheme_();
  if (!email) throw new Error("Could not detect your email.");
  var props = PropertiesService.getScriptProperties();
  if (pref === "system") props.deleteProperty(themeKey_(email));   // default = no key
  else props.setProperty(themeKey_(email), pref);
  return { success: true, theme: pref };
}
```

## 2. Contract

| Call | Returns | Called by the client |
| ------ | --------- | ---------------------- |
| `getUserRole()` | existing object + `theme: "system" \| "light" \| "dark"` | Once, on load. `ScTheme.fromServer(r.theme)` is the first line of its success handler. |
| `setThemePreference(pref)` | `{ success: true, theme }` · throws `Unknown theme: …` or `Could not detect your email.` | When the person changes Appearance on My Profile. A failure rolls the theme back and shows a toast. |
| `getThemePreference()` | `"system" \| "light" \| "dark"` | **Not called.** It exists for completeness; the load path uses `getUserRole()` so there's no extra round trip. |

The client ignores a missing or invalid `theme`, so an older backend degrades to "follow the
device".

## 3. Decisions and why

**Script Properties keyed by email, not `getUserProperties()`.** The web app runs as
`USER_DEPLOYING` (`appsscript.json`). User properties belong to the *effective* user, which is the
deploying account, so `getUserProperties()` would give every visitor one shared theme. This
follows the existing `bdsent_<year>_<email>` keys in Script Properties.

**Active user only, no effective-user fallback.** If `Session.getActiveUser()` returns no email,
reading gives `"system"` and saving throws. That way a session without a detectable email can
never read or overwrite the deploying account's key.

**"system" is stored as no key.** Most people never change it, so the store only holds explicit
choices.

**Not role-gated.** Every signed-in account owns its theme: member, rep, section admin, admin,
and view-only super admin. It's not a data write, so **don't add `requireView_()`,
`requireManagement_()` or any other guard**, and the client doesn't wrap it in `roBlock()`.

**Cost.** One Script Properties read per `getUserRole()` call, and one write per change. Each key
is about 30–40 bytes. Google's limits are 9 KB per value and 500 KB per store, so 100+ members is
far below that, and well within the daily read/write quota.

## 4. Deploying

- **Order doesn't matter while dark mode is off.** With `DARK_READY = false` (in `Page.html`), the
  client forces light and hides the Appearance control, so it never calls
  `setThemePreference`. `Code.gs` can go up before, with, or after the HTML.
- **It must be live before `DARK_READY` is flipped**, or saving the Appearance setting fails with
  "Script function not found".
- Copy `Code.js` → `Code.gs` in the Apps Script project as usual, then **Deploy → Manage
  deployments → Edit → New version**.
- `tools/`, `docs/` and `.claude/` are dev-only. The tools are `.cjs` files, so `clasp push`
  doesn't upload them. If you copy files by hand, don't copy those.

## 5. Testing from the editor

Run as yourself in the Apps Script editor, where your own email is the active user:

```js
function testTheme_() {
  Logger.log(getThemePreference());               // "system" unless you've set one
  Logger.log(JSON.stringify(setThemePreference("dark")));
  Logger.log(getUserRole().theme);                // "dark"
  setThemePreference("system");                   // deletes the key again
  try { setThemePreference("purple"); } catch (e) { Logger.log(e.message); } // Unknown theme: purple
  Logger.log(Object.keys(PropertiesService.getScriptProperties().getProperties())
    .filter(function (k) { return k.indexOf("theme_") === 0; }));           // stored theme keys
}
```

## 6. Keep these true when you change `Code.gs`

- **Every return path of `getUserRole()` includes `theme`.** If you add a new early return, add
  `theme: readThemePreference_()` to it.
- Don't move the preference into a sheet or the Members row. Accounts without a Members row
  (super admin) need it too.
- Don't put colour or theme logic server-side, and **never theme email templates**. They render
  in the recipient's inbox (`THEMING.md` §3 rule 8).
- The `theme_` key prefix is reserved for this feature in Script Properties.

---

## 7. Found along the way (not changed) — please verify

**`getAccess_()` falls back to the deploying account's identity.** At ~L252–258:

```js
if (!email) { try { email = Session.getActiveUser().getEmail() || ""; } catch (e) {} }
if (!email) { try { email = Session.getEffectiveUser().getEmail() || ""; } catch (e) {} }
```

The comment says the second line is for time-based triggers. In the **web app**, though, the
effective user is the deploying account (`executeAs: USER_DEPLOYING`). Google documents that
`getActiveUser().getEmail()` comes back **blank** for a visitor when the script runs as the
developer, unless the visitor is in the same Google Workspace domain as the developer. So:

- If the deployment's access is **"Anyone within [domain]"** (what the README's setup step
  says), every visitor is in the domain, their email resolves, and the fallback never runs in
  the web app. That's fine.
- If the deployment's access is **"Anyone"** (what `appsscript.json` says, `"access": "ANYONE"`),
  a visitor signed in with an outside Google account could resolve to the **deploying account's
  email, and so its role**, likely admin.

I haven't confirmed which setting the live deployment uses. Please check **Deploy → Manage
deployments → Who has access**. Making the manifest match the README (`"DOMAIN"`) would also
help. If the fallback is only needed for triggers, a safer shape is to use the effective user only
when there is no web request: for example, triggers always pass `emailOverride`, and the web path
treats a blank email as `role: "unknown"`. The theme endpoints already avoid this fallback.
