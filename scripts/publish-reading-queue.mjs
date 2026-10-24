#!/usr/bin/env node
// Move approved items from the reading queue (data/reading-queue.yaml) to
// the reading log (data/reading.yaml).
//
// Links from my Bluesky posts and Substack Notes are imported into the
// queue, which the site doesn't show. In the admin's "Reading queue" I edit
// an item's title, note or date, tick "Publish" and save; this then moves
// it to the top of the log (without its publish/source fields) and removes
// it from the queue. Deleting an item from the queue discards it. A link
// that's already in the log is only removed from the queue, so a save from
// a stale admin tab that brings back a published item can't log it twice.
//
// Lines are moved as they are (no YAML re-serialization), so the CMS's
// quoting and multi-line notes survive.
//
// Usage: node scripts/publish-reading-queue.mjs [reading-queue.yaml] [reading.yaml]
// Run by .github/workflows/fill-reading-titles.yml on every push.

import { readFileSync, writeFileSync } from "node:fs";
import { itemBlocks, knownLinks, sameLinkKey } from "./reading-lib.mjs";

const queuePath = process.argv[2] || "data/reading-queue.yaml";
const readingPath = process.argv[3] || "data/reading.yaml";

const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, "$2").trim();

const qLines = readFileSync(queuePath, "utf8").split("\n");
const queue = itemBlocks(qLines);
if (!queue) {
  console.log(`${queuePath}: no top-level "items:" key; nothing to publish.`);
  process.exit(0);
}
const keyRe = (k) => new RegExp(`^(${queue.listIndent}- |${queue.keyIndent})${k}:(.*)$`);
const value = (b, k) => {
  for (let i = b.start; i < b.end; i++) {
    const m = qLines[i].match(keyRe(k));
    if (m) return unquote(m[2]);
  }
  return "";
};

const approved = queue.blocks.filter((b) => value(b, "publish") === "true");
if (!approved.length) {
  console.log(`${queuePath}: nothing ticked "Publish".`);
  process.exit(0);
}

const rLines = readFileSync(readingPath, "utf8").split("\n");
let log = itemBlocks(rLines);
if (!log) {
  rLines.push("items:");
  log = itemBlocks(rLines);
}
const known = knownLinks(rLines.join("\n"));

const moved = []; // lines for the log
let published = 0;
for (const b of approved) {
  const link = value(b, "link");
  const key = sameLinkKey(link);
  if (known.has(key)) {
    console.log(`  already in the log, dropped from the queue: ${link}`);
    continue;
  }
  known.add(key);
  // Drop the queue-only fields; if one of them opened the item ("- "),
  // the next line opens it instead.
  const out = [];
  let opener = false;
  for (let i = b.start; i < b.end; i++) {
    const m = qLines[i].match(keyRe("(publish|source)"));
    if (m) {
      if (m[1].includes("- ")) opener = true;
      continue;
    }
    let line = qLines[i];
    if (opener && line.startsWith(queue.keyIndent)) {
      line = queue.listIndent + "- " + line.slice(queue.keyIndent.length);
      opener = false;
    }
    out.push(line);
  }
  // Re-indent from the queue's list indentation to the log's.
  moved.push(...out.map((l) => (l.trim() ? log.listIndent + l.slice(queue.listIndent.length) : l)));
  published++;
  console.log(`  → ${value(b, "date")} ${link}`);
}

// Remove every approved item from the queue, bottom-up so line numbers hold.
for (const b of [...approved].reverse()) qLines.splice(b.start, b.end - b.start);
if (!itemBlocks(qLines).blocks.length) {
  // Nothing left: an empty list, and no stray lines under it.
  const i = qLines.findIndex((l) => /^items:/.test(l));
  let j = i + 1;
  while (j < qLines.length && !/^\S/.test(qLines[j])) j++;
  qLines.splice(i, j - i, "items: []", ...(j === qLines.length ? [""] : []));
}
writeFileSync(queuePath, qLines.join("\n"));

if (moved.length) {
  rLines[log.itemsIdx] = "items:"; // also turns an empty "items: []" into a list
  rLines.splice(log.itemsIdx + 1, 0, ...moved);
  writeFileSync(readingPath, rLines.join("\n"));
}
console.log(`${readingPath}: published ${published} queued item(s)` +
  (published < approved.length ? `; ${approved.length - published} already logged` : "") + ".");
