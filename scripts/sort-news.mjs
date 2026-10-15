#!/usr/bin/env node
// Sort data/news.yaml items newest-first by date, so the admin panel's
// News list shows them in the same order as the website.
//
// The CMS list widget has no sort option — it shows items in file order —
// so we reorder the file itself. Items are moved as whole text blocks
// (no YAML re-serialization), so quoting and formatting are untouched.
//
// Usage: node scripts/sort-news.mjs [path]   (default: data/news.yaml)
// Run automatically by .github/workflows/sort-news.yml on every push.

import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] || "data/news.yaml";
const src = readFileSync(path, "utf8");
const lines = src.split("\n");

// Header = everything up to and including the `items:` line.
const itemsIdx = lines.findIndex((l) => /^items:\s*$/.test(l));
if (itemsIdx === -1) {
  console.error(`${path}: no top-level "items:" key; leaving file alone.`);
  process.exit(0);
}
const header = lines.slice(0, itemsIdx + 1);
const rest = lines.slice(itemsIdx + 1);

// Items start with "  - " at the list's indentation. Anything after the
// list (a new top-level key) is kept as a trailer.
const listIndent = (rest.find((l) => /^\s*- /.test(l)) || "  - ").match(/^\s*/)[0];
const blocks = [];
const trailer = [];
let inTrailer = false;
for (const line of rest) {
  if (!inTrailer && /^\S/.test(line)) inTrailer = true;
  if (inTrailer) { trailer.push(line); continue; }
  if (line.startsWith(listIndent + "- ")) blocks.push([line]);
  else if (blocks.length) blocks[blocks.length - 1].push(line);
  else header.push(line);
}

// Pull trailing blank lines off the last block so they stay at file end.
const tailBlank = [];
const last = blocks[blocks.length - 1];
while (last && last.length > 1 && last[last.length - 1].trim() === "") tailBlank.unshift(last.pop());

const dateOf = (block) => {
  for (const l of block) {
    const m = l.match(/^\s*(?:- )?date:\s*['"]?(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return ""; // undated items sink to the bottom
};

// Stable sort, newest first.
const sorted = blocks
  .map((b, i) => ({ b, i, d: dateOf(b) }))
  .sort((x, y) => (x.d === y.d ? x.i - y.i : x.d < y.d ? 1 : -1))
  .map((x) => x.b);

const out = [...header, ...sorted.flat(), ...tailBlank, ...trailer].join("\n");
if (out !== src) {
  writeFileSync(path, out);
  console.log(`${path}: sorted ${blocks.length} items by date (newest first).`);
} else {
  console.log(`${path}: already in date order.`);
}
