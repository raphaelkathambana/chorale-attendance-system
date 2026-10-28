#!/usr/bin/env node
/*
 * Theme render check — renders the real Page.html + Scripts.html in headless Chromium against
 * a fake backend (tools/theme/fixtures.cjs) and checks three things:
 *
 *   light   The working tree in light mode must be pixel-identical to --base (default
 *           origin/main). Differences listed in accepted-light-changes.css are applied to the
 *           base first, so only UNEXPECTED light changes are reported.
 *   gated   While DARK_READY is false, a dark-OS device with a saved "dark" preference must
 *           still get light: compared pixel-for-pixel against the working tree's light render.
 *   dark    The working tree with dark mode previewed. Not compared against anything — these
 *           are the screenshots to review by eye (index.html shows light and dark side by side).
 *
 *   node tools/theme/render.cjs [--base <git-ref>] [--out <dir>] [--scenario admin|member|member-failed|superadmin]
 *                               [--screens record,sessions,…] [--no-base]
 *
 * Exit code 1 on any unexpected light difference or a failed gated check.
 * Needs Playwright with Chromium (preinstalled in Claude Code cloud sessions). `.cjs` so
 * `clasp push` never uploads it into Apps Script.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { fixtures, FIXED_NOW, MY_APOLOGY } = require("./fixtures.cjs");

function loadPlaywright() {
  const tries = ["playwright", "/opt/node-tools/node_modules/playwright", process.env.PLAYWRIGHT_MODULE].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) {} }
  console.error("theme-render: Playwright not found. npm i -D playwright, or set PLAYWRIGHT_MODULE to its path.");
  process.exit(2);
}

const VIEWPORTS = [{ id: "mobile", width: 390, height: 844 }, { id: "desktop", width: 1440, height: 960 }];
// Each screen is reached the way a user would: the app's own navigation functions.
//   go     a JS string, or a list of steps with a settle between each (e.g. load a list, then open an item)
//   state  fixture state for this screen (fixtures.cjs: role, year, myApology). A screen with state, or
//          with fresh: true, boots the app fresh, and so does the screen after it, so nothing leaks.
const MY_APOLOGY_SCREENS = Object.keys(MY_APOLOGY).map(k => ({ id: "myatt-apology-" + k, state: { myApology: k }, go: "switchTab('myatt')" }));
const SCREENS = {
  admin: [
    { id: "record", go: "switchTab('record')" },
    { id: "sessions", go: "switchTab('sessions')" },
    { id: "session-detail", go: "switchTab('sessions'); openSession('2026-10-07', 'Choir')" },
    { id: "members", go: "switchTab('members')" },
    { id: "member-detail", go: "switchTab('members'); selectMember('Victor Otieno')" },
    { id: "member-history", go: "switchTab('members'); setMembersMode('member'); loadMemberHistory('Brian Otieno')" },
    { id: "scoreboard", go: "switchTab('members'); setMembersMode('scoreboard')" },
    { id: "probation", go: "switchTab('probation')" },
    { id: "requests", go: "switchTab('requests')" },
    { id: "dashboard", go: "switchTab('dashboard')" },
    { id: "communique", go: "switchTab('communique')" },
    { id: "myatt", go: "switchTab('myatt')" },
    { id: "apology", go: "switchTab('myatt'); openApology('session')" },
    { id: "profile", go: "openProfile()" },
    { id: "members-add", go: "switchTab('members'); setMembersMode('add'); document.getElementById('amName').value = 'Wanjiku Mwende'; " +
        "document.getElementById('amEmail').value = 'wanjiku.mwende@example.org'; renderAddMemberPreview()" },
    { id: "post-save", go: "switchTab('record'); showPostSubmit({ summary: { Choir: { 'Present': 8, 'Late Excused': 1, 'Absent Unexcused': 2 } }, " +
        "probationEvals: [{ name: 'Ian Mwangi', result: 'passed_clean', attended: 9, rate: 90 }, { name: 'Joy Wambui', result: 'Failed', attended: 3, rate: 30, penalty: -5 }] })" },
    // Added in the 17bab8d sync (plan §4): years, activity, drafts, additional info, scoped views, meetings, notices
    { id: "year-before", state: { year: "before" }, go: "openYearPage()" },
    { id: "year-available", state: { year: "available" }, go: "openYearPage()" },
    { id: "year-pending", state: { year: "pending" }, go: "openYearPage()" },
    { id: "past-year-dashboard", fresh: true, go: ["switchTab('dashboard')", "setActiveYear('2024/25')"] },
    { id: "past-year-sessions", fresh: true, go: ["switchTab('sessions')", "setActiveYear('2024/25')"] },
    { id: "comm-drafts", go: "switchTab('communique'); showCommSubtab('drafts')" },
    { id: "activity", go: "switchTab('activity')" },
    { id: "member-info", fresh: true, go: ["switchTab('members'); selectMember('Victor Otieno')", "toggleMemberInfo()"] },
    { id: "member-info-sectionadmin", state: { role: "sectionAdmin" }, go: ["switchTab('members'); selectMember('Victor Otieno')", "toggleMemberInfo()"] },
    { id: "session-detail-sectionadmin", state: { role: "sectionAdmin" }, go: "switchTab('sessions'); openSession('2026-10-03', 'Band,Choir')" },
    { id: "meeting-edit", fresh: true, go: ["switchTab('record'); document.getElementById('meetingPanel').open = true; loadMeetings()", "editMeeting(4)"] },
    { id: "toast-info", fresh: true, go: "showToast('Already submitted \u2014 this register was saved a moment ago.', 'info')" },
    { id: "toast-warning", fresh: true, go: "showToast('Saved 9 of 11 changes. 2 were skipped because the register changed meanwhile.', 'warning')" },
    // D11: with System selected the Appearance row reads "Following your device · Dark/Light".
    // The row only shows once dark mode is available, so this is checked in the dark render.
    { id: "profile-system", fresh: true, go: "ScTheme.use('system'); openProfile()" },
  ],
  member: [
    { id: "myatt", go: "switchTab('myatt')" },
    { id: "apology", go: "openApology('session')" },
    { id: "profile", go: "openProfile()" },
  ].concat(MY_APOLOGY_SCREENS, [
    // The emergency door and the apology-page hint carry two of D8's five crimson marks
    // (the Requests queue carries the other three).
    { id: "myatt-emergency-door", state: { emergency: "prominent" }, go: "switchTab('myatt')" },
    { id: "apology-emergency-hint", state: { emergency: "hidden" }, go: "switchTab('myatt'); openApology('session')" },
    { id: "profile-system", fresh: true, go: "ScTheme.use('system'); openProfile()" },
    { id: "apology-on-file", state: { myApology: "pending" },
      go: ["switchTab('myatt'); openApology('session')", "document.getElementById('apolSessionSelect').value = '0'; onApolSessionSelect()"] },
  ]),
  "member-failed": [ // a member whose probation failed: the crimson restart card
    { id: "myatt", go: "switchTab('myatt')" },
    { id: "apology", go: "openApology('session')" },
    { id: "profile", go: "openProfile()" },
  ],
  superadmin: [ // view-only: action controls hidden, communiqué hidden, no personal attendance
    { id: "sessions", go: "switchTab('sessions')" },
    { id: "session-detail", go: "switchTab('sessions'); openSession('2026-10-07', 'Choir')" },
    { id: "members", go: "switchTab('members')" },
    { id: "member-detail", go: "switchTab('members'); selectMember('Victor Otieno')" },
    { id: "member-info", fresh: true, go: ["switchTab('members'); selectMember('Victor Otieno')", "toggleMemberInfo()"] },
    { id: "scoreboard", go: "switchTab('members'); setMembersMode('scoreboard')" },
    { id: "probation", go: "switchTab('probation')" },
    { id: "requests", go: "switchTab('requests')" },
    { id: "dashboard", go: "switchTab('dashboard')" },
    { id: "activity", go: "switchTab('activity')" },
    { id: "year", state: { year: "before" }, go: "openYearPage()" },
    { id: "past-year-dashboard", fresh: true, go: ["switchTab('dashboard')", "setActiveYear('2024/25')"] },
    { id: "profile", go: "openProfile()" },
  ],
};

function parseArgs(argv) {
  const o = { base: "origin/main", out: null, scenario: "admin", screens: null, noBase: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") o.base = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--scenario") o.scenario = argv[++i];
    else if (a === "--screens") o.screens = argv[++i].split(",");
    else if (a === "--no-base") o.noBase = true;
    else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(0); }
  }
  o.out = path.resolve(o.out || path.join(process.env.TMPDIR || "/tmp", "theme-render"));
  return o;
}

// Page.html with every <?!= include("X") ?> replaced by X.html — what HtmlService serves.
function buildPage(readFile) {
  return readFile("Page.html").replace(/<\?!=\s*include\(\s*["']([\w-]+)["']\s*\)\s*\?>/g, (_, name) => readFile(name + ".html"));
}
const readWorking = f => fs.readFileSync(f, "utf8");
const readAtRef = ref => f => execFileSync("git", ["show", `${ref}:${f}`], { encoding: "utf8", maxBuffer: 1 << 28 });

// google.script.run stand-in. Calls cross into Node (fixtures.cjs) through __callServer;
// __pending lets the renderer wait until every handler has run before taking a screenshot.
const STUB = `<script>
(function () {
  window.__pending = 0; window.__calls = []; window.__handlerErrors = [];
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === "withSuccessHandler") return function (f) { return runner(f, fail); };
      if (name === "withFailureHandler") return function (f) { return runner(ok, f); };
      if (name === "withUserObject") return function () { return runner(ok, fail); };
      return function () {
        var args = [].slice.call(arguments); window.__calls.push(name); window.__pending++;
        window.__callServer(name, JSON.stringify(args)).then(function (res) {
          setTimeout(function () {
            try { res.error ? (fail && fail(new Error(res.error))) : (ok && ok(res.value)); }
            catch (e) { window.__handlerErrors.push(name + ": " + e.message); }
            window.__pending--;
          }, 0);
        });
      };
    }});
  }
  window.google = { script: { run: runner(null, null),
    url: { getLocation: function (cb) { cb({ parameter: {}, parameters: {}, hash: "" }); } },
    host: { close: function () {}, setHeight: function () {} } } };
})();
</script>`;

const MODES = {
  light: { colorScheme: "light", preview: false, serverTheme: "system" },
  gated: { colorScheme: "dark", preview: false, serverTheme: "dark" },
  dark: { colorScheme: "dark", preview: true, serverTheme: "dark" },
};

async function renderAll(browser, html, label, mode, screens, out, extraCss) {
  const m = MODES[mode], state = {}, fx = fixtures(label.scenario, state), shots = {}, log = [];
  const file = path.join(out, `${label.name}-${mode}.html`);
  let page = html.replace("</head>", STUB + (extraCss ? `<style>${extraCss}</style>` : "") + "</head>");
  fs.writeFileSync(file, page);
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: m.colorScheme,
      timezoneId: "Africa/Nairobi", locale: "en-US", reducedMotion: "reduce" });
    await ctx.clock.setFixedTime(new Date(FIXED_NOW));
    if (m.preview) await ctx.addInitScript(() => { try { localStorage.setItem("sc-theme-preview", "1"); } catch (e) {} });
    await ctx.route(/^https?:\/\//, r => r.abort()); // fonts, Drive images: fallbacks keep renders deterministic
    const p = await ctx.newPage();
    p.on("pageerror", e => log.push(`[${vp.id}] page error: ${e.message}`));
    await p.exposeFunction("__callServer", (name, argsJson) => {
      const fn = fx[name];
      try {
        if (name === "getUserRole") return { value: Object.assign({}, fn(), { theme: m.serverTheme }) };
        if (!fn) return { value: /^(get|list|count)/.test(name) ? [] : { success: true } };
        return { value: fn.apply(null, JSON.parse(argsJson)) };
      } catch (e) { return { error: e.message }; }
    });
    // Settled = no call in flight and no NEW call for 400 ms (outlasts the 220 ms debounces),
    // then two animation frames so the last render has painted.
    const settle = async () => {
      const t0 = Date.now();
      let lastCalls = -1, quietSince = Date.now();
      while (Date.now() - t0 < 8000) {
        const st = await p.evaluate(() => ({ pending: window.__pending, calls: window.__calls.length }));
        if (st.calls !== lastCalls || st.pending) { lastCalls = st.calls; quietSince = Date.now(); }
        else if (Date.now() - quietSince >= 400) break;
        await p.waitForTimeout(50);
      }
      if (Date.now() - t0 >= 8000) log.push(`[${vp.id}] page never settled (server calls kept coming)`);
      await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    };
    const boot = async st => {
      Object.keys(state).forEach(k => delete state[k]); Object.assign(state, st || {});
      await p.goto("file://" + file); await settle();
    };
    await boot();
    let dirty = false;
    for (const s of screens) {
      const isolated = !!(s.fresh || s.state);
      if (isolated || dirty) await boot(s.state);
      dirty = isolated;
      for (const step of [].concat(s.go)) {
        await p.evaluate(js => { try { (0, eval)(js); } catch (e) { window.__handlerErrors.push("navigate: " + e.message); } }, step);
        await settle();
      }
      await p.evaluate(() => window.scrollTo(0, 0));
      // A screen still loading checked nothing: say so, so a missing fixture can't pass as a green run.
      const loading = await p.evaluate(() => {
        const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";
        // .loading is also the app's empty-state class ("Tap Refresh to load."), so only count a
        // visible spinner, or text that says it is still working.
        const busy = [...document.querySelectorAll(".spinner, .loading")].filter(vis).filter(el => !el.closest("#authScreen"))
          .filter(el => el.classList.contains("spinner") || /^(loading|checking)\b|\u2026\s*$/i.test((el.textContent || "").trim()));
        return busy.length ? ((busy[0].closest(".loading") || busy[0]).textContent || "").trim().slice(0, 60) || "spinner" : "";
      });
      if (loading) log.push(`[${vp.id} ${s.id}] still loading: "${loading}"`);
      const shot = path.join(out, `${label.name}-${mode}-${vp.id}-${s.id}.png`);
      await p.screenshot({ path: shot, fullPage: true, animations: "disabled", caret: "hide" });
      shots[`${vp.id}-${s.id}`] = shot;
      const errs = await p.evaluate(() => window.__handlerErrors.splice(0));
      errs.forEach(e => log.push(`[${vp.id} ${s.id}] ${e}`));
    }
    if (mode === "gated") label.enabledWithoutPreview = await p.evaluate(() => !!(window.ScTheme && window.ScTheme.enabled()));
    await ctx.close();
  }
  return { shots, log };
}

// accepted-light-changes.css: one entry per intended light-mode change, each opened by a comment
//   /* accept: <title naming the THEMING.md section>
//      match: <regex that matches the head's Page.html/Scripts.html once the change is in> */
// followed by the CSS that reproduces the change on the base.
function parseAccepted(text) {
  const out = [], re = /\/\*\s*accept:([\s\S]*?)\*\/([\s\S]*?)(?=\/\*\s*accept:|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const head = m[1], mm = /\bmatch:\s*(.+)/.exec(head);
    if (!mm) throw new Error("accepted-light-changes.css: entry without a match: line → " + head.trim().split("\n")[0]);
    out.push({ title: head.split(/\bmatch:/)[0].replace(/\s+/g, " ").trim(), match: new RegExp(mm[1].trim()), css: m[2].trim() });
  }
  return out;
}

// Pixel comparison inside the browser (canvas), so no image library is needed.
async function compare(browser, a, b, diffPath) {
  const p = await (await browser.newContext()).newPage();
  const res = await p.evaluate(async ([A, B]) => {
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(A), load(B)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.width, ia.height, ib.width, ib.height] };
    const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height;
    const x = c.getContext("2d");
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height);
    x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height);
    const out = x.createImageData(c.width, c.height);
    let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < da.data.length; i += 4) {
      const delta = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
      const same = delta === 0;
      if (delta > max) max = delta;
      const g = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3;
      if (same) { out.data[i] = out.data[i + 1] = out.data[i + 2] = 200 + g / 5; }
      else { n++; out.data[i] = 230; out.data[i + 1] = 20; out.data[i + 2] = 60;
        const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width);
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
      out.data[i + 3] = 255;
    }
    if (!n) return { n: 0 };
    x.putImageData(out, 0, 0);
    return { n, max, box: [x0, y0, x1, y1], png: c.toDataURL("image/png") };
  }, [a, b].map(f => "data:image/png;base64," + fs.readFileSync(f).toString("base64")));
  await p.context().close();
  if (res.png) fs.writeFileSync(diffPath, Buffer.from(res.png.split(",")[1], "base64"));
  return res;
}

function gallery(out, rows) {
  const cell = f => f ? `<a href="${path.basename(f)}"><img src="${path.basename(f)}" loading="lazy"></a>` : "<div class=none>—</div>";
  const html = `<!doctype html><meta charset=utf-8><title>Theme render</title><style>
body{font:13px system-ui;margin:16px;background:#888}h2{font-size:13px;margin:18px 0 6px}
.r{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;align-items:start}.r img{width:100%;display:block;border:1px solid #333}
.h{font-weight:600}.none{padding:20px;text-align:center;background:#bbb}</style>
<p>Columns: base light (with accepted changes) · working tree light · working tree dark. Diff images are named *-diff.png.</p>
${rows.map(r => `<h2>${r.key}${r.status ? " — " + r.status : ""}</h2><div class=r>${cell(r.base)}${cell(r.light)}${cell(r.dark)}</div>`).join("\n")}`;
  fs.writeFileSync(path.join(out, "index.html"), html);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const screens = (SCREENS[o.scenario] || SCREENS.admin).filter(s => !o.screens || o.screens.includes(s.id));
  fs.mkdirSync(o.out, { recursive: true });
  const { chromium } = loadPlaywright();
  // Flags that make Chromium's rasterisation repeatable, so identical CSS gives identical pixels.
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-partial-raster", "--disable-skia-runtime-opts",
    "--disable-lcd-text", "--font-render-hinting=none", "--force-color-profile=srgb", "--disable-threaded-animation"] });
  const accepted = parseAccepted(fs.readFileSync(path.join(__dirname, "accepted-light-changes.css"), "utf8"));
  const head = { name: "head", scenario: o.scenario }, base = { name: "base", scenario: o.scenario };

  const headHtml = buildPage(readWorking);
  const results = {};
  results.light = await renderAll(browser, headHtml, head, "light", screens, o.out);
  results.gated = await renderAll(browser, headHtml, head, "gated", screens, o.out);
  results.dark = await renderAll(browser, headHtml, head, "dark", screens, o.out);
  // An accepted change is applied to the base only when the files being checked have it and the
  // base doesn't yet. Once the base catches up the entry retires itself and the comparison is exact.
  let acceptedNote = "";
  if (!o.noBase) {
    const baseHtml = buildPage(readAtRef(o.base));
    const use = accepted.filter(a => a.match.test(headHtml) && !a.match.test(baseHtml));
    acceptedNote = accepted.map(a => `  accepted · ${use.includes(a) ? "APPLIED " : "not used"} · ${a.title}`).join("\n");
    results.base = await renderAll(browser, baseHtml, base, "light", screens, o.out, use.map(a => a.css).join("\n"));
  }

  let failures = 0;
  const rows = [];
  console.log(`theme-render → ${o.out}\nscenario ${o.scenario}, clock ${FIXED_NOW}, ${screens.length} screens × ${VIEWPORTS.length} viewports`);
  console.log((acceptedNote ? acceptedNote + "\n" : "") + "");
  for (const key of Object.keys(results.light.shots)) {
    const row = { key, light: results.light.shots[key], dark: results.dark.shots[key], base: results.base && results.base.shots[key] };
    const notes = [];
    if (row.base) {
      const d = await compare(browser, row.base, row.light, path.join(o.out, `light-vs-base-${key}-diff.png`));
      if (d.size) { failures++; notes.push(`LIGHT size differs from ${o.base}: ${d.size[0]}×${d.size[1]} → ${d.size[2]}×${d.size[3]}`); }
      else if (d.n) { failures++; notes.push(`LIGHT differs from ${o.base}: ${d.n} px (max channel Δ${d.max}) in box ${d.box.join(",")}`); }
      else notes.push("light identical");
    }
    if (!head.enabledWithoutPreview) {
      const g = await compare(browser, row.light, results.gated.shots[key], path.join(o.out, `gated-${key}-diff.png`));
      if (g.n || g.size) { failures++; notes.push("GATED render is not light — dark mode leaks past DARK_READY"); }
      else notes.push("gate holds");
    }
    row.status = notes.join(" · ");
    rows.push(row);
    console.log(`  ${key.padEnd(24)} ${row.status}`);
  }
  if (head.enabledWithoutPreview) console.log("\n  (DARK_READY is on — gated check skipped)");
  const logs = ["light", "dark", "base"].flatMap(k => (results[k] ? results[k].log.map(l => `${k}: ${l}`) : []));
  if (logs.length) console.log("\nRender log (fixture gaps show up here — see fixtures.cjs):\n  " + [...new Set(logs)].join("\n  "));
  gallery(o.out, rows);
  console.log(`\nReview dark screenshots: ${path.join(o.out, "index.html")}`);
  console.log(failures ? `\n${failures} problem(s).` : "\nAll light and gate checks passed.");
  await browser.close();
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
