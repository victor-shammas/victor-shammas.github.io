// Generate the monitors' data blocks FROM static/embeds/_shared/monitors.config.json.
//
// monitors.config.json is the source of truth. This script writes the
// generated arrays into each embed (PANELS/PARTIES) and greenlist.js
// (GREENLIST/REDLIST), between @genstart/@genend markers, so those files never
// have to be hand-edited. Edit the JSON, then run this.
//
//   node scripts/gen-monitors.mjs           # write the generated blocks
//   node scripts/gen-monitors.mjs --check    # exit 1 if any file is out of date
//
// Generation is injection-safe: values are emitted with JSON.stringify, so a
// query like "Workers' Party" or the Unicode redlist entry can't break out of
// its literal.

import { readFileSync, writeFileSync } from "node:fs";

const CONFIG_PATH = "static/embeds/_shared/monitors.config.json";
const GREENLIST_PATH = "static/embeds/_shared/greenlist.js";
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

// (file, declaration name, data) triples to keep in sync with the config.
const TARGETS = [
  { path: GREENLIST_PATH, name: "GREENLIST", data: config.greenlist },
  { path: GREENLIST_PATH, name: "REDLIST", data: config.redlist },
];
for (const [slug, panels] of Object.entries(config.monitors)) {
  const path = `static/embeds/${slug}/index.html`;
  const name = slug === "rightwing-monitor" ? "PARTIES" : "PANELS";
  TARGETS.push({ path, name, data: panels });
}

// Find `const <name> = [ … ];` and return { lineStart, end, indent } spanning
// from the start of its line through the closing `];`. String- and
// comment-aware so brackets/quotes inside query strings don't miscount.
function findDecl(src, name) {
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*\\[`);
  const m = decl.exec(src);
  if (!m) throw new Error(`${name}: declaration not found`);
  const open = m.index + m[0].length - 1;
  let depth = 0, i = open, str = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (str) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); if (i < 0) i = src.length; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2); if (i < 0) i = src.length; else i++; continue; }
    if (c === "'" || c === '"' || c === "`") { str = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error(`${name}: unbalanced brackets`);
  if (src[i] === ";") i++; // include trailing semicolon
  const lineStart = src.lastIndexOf("\n", m.index) + 1;
  const indent = src.slice(lineStart, m.index).match(/^\s*/)[0];
  return { lineStart, end: i, indent };
}

// Build the replacement text: markers + `const NAME = <json>;`, indented.
function block(name, data, indent) {
  const json = JSON.stringify(data, null, 2)
    .split("\n")
    .map((ln, i) => (i === 0 ? ln : indent + ln))
    .join("\n");
  return (
    `${indent}// @genstart ${name} — generated from monitors.config.json; edit that file, run: npm run gen:monitors\n` +
    `${indent}const ${name} = ${json};\n` +
    `${indent}// @genend ${name}`
  );
}

// Replace an existing generated block (between markers) or, on first run, the
// raw declaration found by findDecl.
function apply(src, name, data) {
  const startMark = `// @genstart ${name} `;
  const endMark = `// @genend ${name}`;
  const s = src.indexOf(startMark);
  if (s !== -1) {
    const lineStart = src.lastIndexOf("\n", s) + 1;
    const indent = src.slice(lineStart, s).match(/^\s*/)[0];
    const e = src.indexOf(endMark, s);
    if (e === -1) throw new Error(`${name}: @genstart without @genend`);
    const end = e + endMark.length;
    return src.slice(0, lineStart) + block(name, data, indent) + src.slice(end);
  }
  const { lineStart, end, indent } = findDecl(src, name);
  return src.slice(0, lineStart) + block(name, data, indent) + src.slice(end);
}

const check = process.argv.includes("--check");

// Group targets by file so multiple declarations in one file compose.
const byFile = new Map();
for (const t of TARGETS) {
  if (!byFile.has(t.path)) byFile.set(t.path, []);
  byFile.get(t.path).push(t);
}

let stale = false;
for (const [path, targets] of byFile) {
  const orig = readFileSync(path, "utf8");
  let out = orig;
  for (const t of targets) out = apply(out, t.name, t.data);
  if (out === orig) {
    console.log(`= ${path} (up to date)`);
  } else if (check) {
    stale = true;
    console.error(`✗ ${path} out of date with ${CONFIG_PATH}`);
  } else {
    writeFileSync(path, out);
    console.log(`✎ ${path} (regenerated ${targets.map((t) => t.name).join(", ")})`);
  }
}

if (check && stale) {
  console.error("Run: npm run gen:monitors");
  process.exit(1);
}
if (check) console.log("✓ all generated blocks in sync.");
