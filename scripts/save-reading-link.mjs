#!/usr/bin/env node
// Add a link straight to the top of the reading log (data/reading.yaml),
// dated today (Oslo). Run by .github/workflows/save-reading-link.yml, which
// my "Save to Reading" Apple Shortcut starts from the share sheet.
//
// Input comes from environment variables (never the command line, so a
// crafted link can't reach a shell): READING_LINK (required; the shared
// text, which may hold the URL among other words), READING_NOTE and
// READING_TITLE (optional; a blank title is filled in by
// fill-reading-titles.mjs). The link is cleaned of tracking parameters like
// imported ones. A link already in the log is left alone; one waiting in
// the queue is dropped from it the next time the queue is published.
//
// Usage: READING_LINK=… node scripts/save-reading-link.mjs [reading.yaml]

import { readFileSync, writeFileSync } from "node:fs";
import { clean, cleanLink, insertItems, knownLinks, linkFromShare, osloDate, sameLinkKey } from "./reading-lib.mjs";

const readingPath = process.argv[2] || "data/reading.yaml";
const MAX_LINK = 2000;
const MAX_NOTE = 2000;

const shared = process.env.READING_LINK || "";
const link = shared.length <= 4 * MAX_LINK ? linkFromShare(shared) : null;
if (!link || link.length > MAX_LINK) {
  console.log(`::error::No http(s) link found in what was shared (${shared.length} characters).`);
  process.exit(1);
}
const note = (process.env.READING_NOTE || "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_NOTE);
const title = clean(process.env.READING_TITLE || "");

const src = readFileSync(readingPath, "utf8");
if (knownLinks(src).has(sameLinkKey(link))) {
  console.log(`Already in the reading log: ${link}`);
  process.exit(0);
}

const now = new Date().toISOString();
writeFileSync(readingPath, insertItems(src, [{ created: now, date: osloDate(now), link: await cleanLink(link), title, note }]));
console.log(`${readingPath}: saved.`);
