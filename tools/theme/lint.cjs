#!/usr/bin/env node
/*
 * Theme lint — finds colour that bypasses the design tokens (docs/THEMING.md §3).
 *
 *   node tools/theme/lint.cjs                    whole files: every colour literal outside allowed regions
 *   node tools/theme/lint.cjs --since <ref>      only lines added since <ref>, plus the judgment calls
 *   node tools/theme/lint.cjs --summary          counts per file and rule instead of every hit
 *   node tools/theme/lint.cjs [--since <ref>] Page.html Scripts.html   (these two are the default)
 *
 * Exit code 1 when any colour literal is found, so CI can use it. Judgment calls never fail the run.
 *
 * Allowed regions — literals that are meant to be literal (token definitions, email previews,
 * the communiqué signature palette) are marked in the source, not listed here, so the marker
 * moves with the code:
 *   theme-lint: off   …   theme-lint: on     skip every line in between (markers in any comment)
 *   theme-lint: allow                         skip this one line
 *
 * Plain Node, no dependencies. `.cjs` so `clasp push` never uploads it into Apps Script.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const LITERAL_RULES = [
  { id: "hex", re: /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g, fix: "use a var(--token)" },
  { id: "rgb", re: /\brgba?\((?!\s*var\()/g, fix: "use rgba(var(--…-rgb), alpha) — THEMING.md §2c" },
  { id: "hsl", re: /\bhsla?\(/g, fix: "use a var(--token)" },
  { id: "named", re: /(?<![-\w$.])(?:white|black)\b(?![-\w])/g, fix: "use --surface / --on-accent / --ink" },
];

// Patterns that are valid code but need a human decision when they are NEW (THEMING.md §3).
const JUDGMENT_RULES = [
  { id: "ink-background", re: /background(?:-color)?\s*:\s*var\(--ink(?:-\d+)?\)/g,
    ask: "Selected/primary state that should invert (rule 3: keep) or a card that is dark by design (rule 4: --inverse)?" },
  { id: "paper-text", re: /(?<![-\w])color\s*:\s*var\(--paper(?:-\d+)?\)/g,
    ask: "Text on an inverting state (rule 3: keep) or on a dark card (rule 4: --on-inverse)?" },
  { id: "fg-as-fill", re: /background(?:-color)?\s*:\s*var\(--(?:gold|crimson|present|late-exc|late-unexc|absent-exc|absent-unexc)\)/g,
    ask: "Filled control under --on-accent text? Use the *-fill token (§2a). A small dot or bar can keep the fg token." },
  { id: "active-chip", re: /(?:\.active|is-active|aria-pressed)[^{]*\{[^}]*background\s*:\s*var\(--(?:paper|surface)\)/g,
    ask: "Raised chip on a --paper-100 track? Use --seg-active (§3a)." },
];

function parseArgs(argv) {
  const opts = { since: null, summary: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") opts.since = argv[++i];
    else if (a === "--summary") opts.summary = true;
    else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(0); }
    else opts.files.push(a);
  }
  if (!opts.files.length) opts.files = ["Page.html", "Scripts.html"];
  return opts;
}

// Line numbers (1-based) that the allow markers exclude.
function skippedLines(lines) {
  const skip = new Set();
  let off = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/theme-lint:\s*off\b/.test(line)) off = true;
    if (off || /theme-lint:\s*allow\b/.test(line)) skip.add(n);
    if (/theme-lint:\s*on\b/.test(line)) off = false;
  });
  return skip;
}

function matchRules(rules, text) {
  const out = [];
  for (const r of rules) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text))) out.push({ rule: r, match: m[0] });
  }
  return out;
}

// { file: Set(lineNumbers) } of lines added since `ref`, read from `git diff -U0`.
function addedLines(ref, files) {
  const diff = execFileSync("git", ["diff", "-U0", "--no-color", ref, "--", ...files], { encoding: "utf8", maxBuffer: 1 << 28 });
  const added = {};
  let file = null, lineNo = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) { file = line.slice(4).replace(/^b\//, ""); added[file] = added[file] || new Set(); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { lineNo = +h[1]; continue; }
    if (file && line.startsWith("+")) { added[file].add(lineNo); lineNo++; }
  }
  return added;
}

function snippet(line, match) {
  const at = Math.max(0, line.indexOf(match) - 50);
  const s = line.slice(at, at + 130).trim();
  return (at > 0 ? "…" : "") + s + (line.length > at + 130 ? "…" : "");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const added = opts.since ? addedLines(opts.since, opts.files) : null;
  const literals = [], judgments = [];

  for (const file of opts.files) {
    if (!fs.existsSync(file)) { console.error(`theme-lint: ${file} not found (run from the repo root)`); process.exit(2); }
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const skip = skippedLines(lines);
    const scope = added ? (added[file] || new Set()) : null;
    lines.forEach((line, i) => {
      const n = i + 1;
      if (skip.has(n) || (scope && !scope.has(n))) return;
      for (const h of matchRules(LITERAL_RULES, line)) literals.push({ file, n, line, ...h });
      if (scope) for (const h of matchRules(JUDGMENT_RULES, line)) judgments.push({ file, n, line, ...h });
    });
  }

  const where = opts.since ? `lines added since ${opts.since}` : "whole files";
  if (opts.summary) {
    const counts = {};
    for (const h of literals) { const k = `${h.file}  ${h.rule.id}`; counts[k] = (counts[k] || 0) + 1; }
    for (const h of judgments) { const k = `${h.file}  review:${h.rule.id}`; counts[k] = (counts[k] || 0) + 1; }
    console.log(`theme-lint (${where})`);
    Object.keys(counts).sort().forEach(k => console.log(`  ${String(counts[k]).padStart(4)}  ${k}`));
  } else {
    if (literals.length) {
      console.log(`Colour literals — ${where} (THEMING.md §3 rule 1)`);
      for (const h of literals) console.log(`  ${h.file}:${h.n}  [${h.rule.id}] ${h.match}  → ${h.rule.fix}\n      ${snippet(h.line, h.match)}`);
    }
    if (judgments.length) {
      console.log(`\nNeeds a decision — new lines only (THEMING.md §3 rules 3–5, §3a)`);
      for (const h of judgments) console.log(`  ${h.file}:${h.n}  [${h.rule.id}] ${h.rule.ask}\n      ${snippet(h.line, h.match)}`);
    }
  }
  console.log(`\n${literals.length} colour literal(s), ${judgments.length} judgment call(s) — ${where}.`);
  process.exit(literals.length ? 1 : 0);
}

main();
