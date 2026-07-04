// Build (or verify) static/embeds/_shared/monitors.config.json — the shared
// source of truth for monitor panel queries plus the greenlist/redlist.
//
// Phase 1 (extract): reads the authoritative data straight out of the live
// embeds and greenlist.js, so the JSON is a provably faithful mirror with zero
// behavior change. The Vault reads this file to stay in sync; a later phase
// flips authority so the embeds are generated FROM this file.
//
//   node scripts/build-monitors-config.mjs           # write the JSON
//   node scripts/build-monitors-config.mjs --check    # exit 1 if out of date
//
// Extraction is safe: each embed's PANELS/PARTIES (and greenlist.js's
// GREENLIST/REDLIST) is a pure data literal, so we slice the literal with a
// string-aware bracket scanner and evaluate it in an isolated Function scope
// with no access to globals.

import { readFileSync, writeFileSync } from "node:fs";

const CONFIG_PATH = "static/embeds/_shared/monitors.config.json";
const GREENLIST_PATH = "static/embeds/_shared/greenlist.js";
const MONITORS = [
  "ai-monitor",
  "space-monitor",
  "tech-monitor",
  "leftpolitics-monitor",
  "rightwing-monitor",
];

// Find `const <name> = [ … ]` and return the array literal text (incl. brackets),
// scanning with awareness of ' " ` strings and escapes so brackets inside query
// strings don't throw off the depth count.
function extractArrayLiteral(src, name) {
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*\\[`);
  const m = decl.exec(src);
  if (!m) throw new Error(`could not find array "${name}"`);
  const start = m.index + m[0].length - 1; // position of the opening [
  let depth = 0, i = start, str = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (str) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === str) str = null;
      continue;
    }
    // Skip comments (they may contain quotes/brackets, e.g. // Harper's).
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); if (i < 0) i = src.length; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2); if (i < 0) i = src.length; else i++; continue; }
    if (c === "'" || c === '"' || c === "`") { str = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error(`unbalanced brackets extracting "${name}"`);
  return src.slice(start, i);
}

function evalArray(literal) {
  // Isolated: no `this`, no closure over module scope; pure data only.
  return Function(`"use strict"; return (${literal});`)();
}

function extractArray(src, name) {
  return evalArray(extractArrayLiteral(src, name));
}

function buildConfig() {
  const greenSrc = readFileSync(GREENLIST_PATH, "utf8");
  const config = {
    version: 1,
    note:
      "Shared source of truth for the RSS monitors — read by the embeds and by the Vault feed resolver. Phase 1: mirror of the live embeds. Edit here going forward.",
    greenlist: extractArray(greenSrc, "GREENLIST"),
    redlist: extractArray(greenSrc, "REDLIST"),
    monitors: {},
  };
  for (const slug of MONITORS) {
    const src = readFileSync(`static/embeds/${slug}/index.html`, "utf8");
    const name = /const\s+PARTIES\s*=/.test(src) ? "PARTIES" : "PANELS";
    config.monitors[slug] = extractArray(src, name);
  }
  return config;
}

const serialize = (cfg) => JSON.stringify(cfg, null, 2) + "\n";

const check = process.argv.includes("--check");
const next = serialize(buildConfig());
if (check) {
  let current = "";
  try { current = readFileSync(CONFIG_PATH, "utf8"); } catch {}
  if (current !== next) {
    console.error(
      `✗ ${CONFIG_PATH} is out of date with the embeds/greenlist.\n  Run: node scripts/build-monitors-config.mjs`
    );
    process.exit(1);
  }
  console.log(`✓ ${CONFIG_PATH} is in sync.`);
} else {
  writeFileSync(CONFIG_PATH, next);
  const cfg = JSON.parse(next);
  const counts = Object.entries(cfg.monitors)
    .map(([m, p]) => `${m}:${p.length}`)
    .join("  ");
  console.log(`Wrote ${CONFIG_PATH}`);
  console.log(`  greenlist:${cfg.greenlist.length}  redlist:${cfg.redlist.length}`);
  console.log(`  panels → ${counts}`);
}
