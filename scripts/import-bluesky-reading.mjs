#!/usr/bin/env node
// Add links I post on Bluesky to the reading log (data/reading.yaml).
//
// Reads my public feed (no login) and, for each of my own posts newer than
// the saved cursor that links somewhere, adds an item at the top of the list:
// date = when I posted it, link = the shared URL, title = the link card's
// title (blank if there's none; fill-reading-titles.mjs then fills it), and
// note = the post's text minus the URL.
//
// Skipped: reposts, quote-posted links (they're someone else's), replies to
// other people (my own threads count), links to my own sites and to Bluesky
// itself, and links already in the log. The cursor (newest post seen) lives
// in data/reading-bluesky.json and is only committed along with new items,
// so an imported entry deleted in the admin never comes back.
//
// Usage: node scripts/import-bluesky-reading.mjs [reading.yaml] [cursor.json]
// Run by .github/workflows/import-bluesky-reading.yml every hour.

import { readFileSync, writeFileSync } from "node:fs";
import { clean, sameLinkKey, stripSiteName, stripTracking } from "./reading-lib.mjs";

const HANDLE = "victorshammas.com";
// Overridable for offline tests.
const API = process.env.READING_BSKY_API || "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const MAX_PAGES = 3; // 100 posts each; runs are hourly, so this is plenty
// My own sites aren't "reading"; links to other Bluesky posts aren't either.
const SKIP_HOSTS = ["victorshammas.com", "theorybrief.com", "hrmn.ai", "bsky.app", "bsky.social", "go.bsky.app"];
const TIMEOUT_MS = 15_000;

const readingPath = process.argv[2] || "data/reading.yaml";
const cursorPath = process.argv[3] || "data/reading-bluesky.json";

const skipHost = (url) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return SKIP_HOSTS.some((s) => h === s || h.endsWith("." + s));
  } catch {
    return true;
  }
};

// Oslo calendar date, matching how the admin's date field is used.
const osloDate = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));

// Links in a post, in order: the link card first, then links in the text.
function postLinks(post) {
  const out = [];
  const e = post.embed || {};
  const ext = e.$type === "app.bsky.embed.external#view" ? e.external
    : e.$type === "app.bsky.embed.recordWithMedia#view" && e.media?.$type === "app.bsky.embed.external#view" ? e.media.external
    : null;
  if (ext?.uri) out.push({ uri: ext.uri, title: ext.title || "" });
  for (const f of post.record?.facets || []) {
    for (const feat of f.features || []) {
      if (feat.$type === "app.bsky.richtext.facet#link" && feat.uri) out.push({ uri: feat.uri, title: "" });
    }
  }
  return out;
}

// The post's text with its link spans removed (facet offsets are UTF-8 bytes).
function noteText(record) {
  const bytes = Buffer.from(record.text || "", "utf8");
  const spans = (record.facets || [])
    .filter((f) => (f.features || []).some((x) => x.$type === "app.bsky.richtext.facet#link"))
    .map((f) => [f.index.byteStart, f.index.byteEnd])
    .sort((a, b) => b[0] - a[0]);
  let buf = bytes;
  for (const [s, e] of spans) buf = Buffer.concat([buf.subarray(0, s), buf.subarray(e)]);
  return buf.toString("utf8")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ")
    .replace(/[\s:–—-]+$/, "").trim();
}

const isMine = (author) => (author?.handle || "").toLowerCase() === HANDLE;

async function fetchFeed(since) {
  const items = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${API}?actor=${encodeURIComponent(HANDLE)}&filter=posts_and_author_threads&limit=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Bluesky HTTP ${res.status}`);
    const data = await res.json();
    items.push(...(data.feed || []));
    const oldest = (data.feed || []).at(-1)?.post?.record?.createdAt;
    cursor = data.cursor;
    if (!cursor || !oldest || oldest <= since) break;
  }
  return items;
}

async function main() {
  const state = JSON.parse(readFileSync(cursorPath, "utf8"));
  const since = state.since;
  if (!since) throw new Error(`${cursorPath}: missing "since"`);

  const src = readFileSync(readingPath, "utf8");
  const known = new Set([...src.matchAll(/^\s*(?:- )?link:\s*(.+)$/gm)]
    .map((m) => sameLinkKey(m[1].trim().replace(/^(['"])(.*)\1$/, "$2"))));

  let feed;
  try {
    feed = await fetchFeed(since);
  } catch (e) {
    // Bluesky being down shouldn't fail the job every hour; the next run retries.
    console.log(`::warning::Couldn't read the Bluesky feed (${e.message}); trying again next run.`);
    return;
  }
  let newest = since;
  const added = [];
  for (const item of feed) {
    const post = item.post;
    if (item.reason || !post || !isMine(post.author)) continue; // reposts, pins
    const created = post.record?.createdAt;
    if (!created || created <= since) continue;
    if (created > newest) newest = created;
    // Replies count only within my own threads.
    if (item.reply && !(isMine(item.reply.parent?.author) && isMine(item.reply.root?.author))) continue;
    const link = postLinks(post).find((l) => /^https?:\/\//i.test(l.uri) && !skipHost(l.uri));
    if (!link) continue;
    const key = sameLinkKey(link.uri);
    if (known.has(key)) continue;
    known.add(key);
    const host = new URL(link.uri).hostname;
    added.push({
      created,
      date: osloDate(created),
      link: stripTracking(link.uri),
      title: link.title ? stripSiteName(clean(link.title), "", host) : "",
      note: noteText(post.record),
    });
  }

  if (!added.length) {
    console.log(`No new links on Bluesky since ${since}.`);
    return;
  }

  // Newest first, inserted at the top of the list (where the admin adds too).
  added.sort((a, b) => (a.created < b.created ? 1 : -1));
  const lines = src.split("\n");
  let i = lines.findIndex((l) => /^items:/.test(l));
  if (i === -1) throw new Error(`${readingPath}: no top-level "items:" key`);
  lines[i] = "items:"; // also turns an empty "items: []" into a list
  const listIndent = (lines.slice(i + 1).find((l) => /^\s*- /.test(l)) || "  - ").match(/^\s*/)[0];
  const k = listIndent + "  ";
  // JSON string syntax is a valid YAML double-quoted scalar.
  const q = (s) => JSON.stringify(s);
  const block = added.flatMap((a) => {
    console.log(`  + ${a.date} ${a.link}${a.title ? `\n    → ${a.title}` : ""}`);
    return [
      `${listIndent}- date: ${a.date}`,
      `${k}link: ${q(a.link)}`,
      `${k}title: ${a.title ? q(a.title) : "''"}`,
      ...(a.note ? [`${k}note: ${q(a.note)}`] : []),
    ];
  });
  lines.splice(i + 1, 0, ...block);
  writeFileSync(readingPath, lines.join("\n"));
  writeFileSync(cursorPath, JSON.stringify({ ...state, since: newest }, null, 2) + "\n");
  console.log(`${readingPath}: added ${added.length} link(s) from Bluesky.`);
}

await main();
