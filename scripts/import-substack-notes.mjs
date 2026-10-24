#!/usr/bin/env node
// Queue links I post in Substack Notes for the reading log
// (data/reading-queue.yaml; see import-bluesky-reading.mjs).
//
// Substack has no official API for Notes, so this reads the public endpoints
// substack.com's own web app uses for a profile page (no login). They're
// undocumented and may change or be blocked; any failure is logged as a
// warning and skipped, so Bluesky and the admin keep working.
//
// Same rules as import-bluesky-reading.mjs: my own Notes only (no restacks,
// no replies), links to my own sites skipped, links already in the log
// and queue skipped (so a link shared on both Bluesky and Notes appears
// once), and the Note's text minus the URL becomes the note. The cursor
// lives in data/reading-substack.json and is only committed along with new
// items, so an entry deleted from the queue never comes back.
//
// Usage: node scripts/import-substack-notes.mjs [reading-queue.yaml] [cursor.json] [reading.yaml]
// Run by .github/workflows/import-reading-links.yml every hour.

import { readFileSync, writeFileSync } from "node:fs";
import { clean, cleanLink, insertItems, isReadingLink, knownLinks, osloDate, sameLinkKey, stripSiteName, UA } from "./reading-lib.mjs";

const HANDLE = "victorshammas";
// Tried in order. substack.com answers GitHub's runners with 403, but
// Substack serves the same API on a newsletter's own domain, which lets them
// in (the deploy reads theorybrief.com/api/v1/archive). Overridable
// (comma-separated) for offline tests.
const APIS = (process.env.READING_SUBSTACK_API || "https://substack.com/api/v1,https://www.theorybrief.com/api/v1").split(",");
const NOTES_PAGE = process.env.READING_SUBSTACK_NOTES_PAGE || "https://www.theorybrief.com/notes";
const MAX_PAGES = 3;
const TIMEOUT_MS = 15_000;

const queuePath = process.argv[2] || "data/reading-queue.yaml";
const cursorPath = process.argv[3] || "data/reading-substack.json";
const readingPath = process.argv[4] || "data/reading.yaml";

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json", "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}${new URL(url).pathname}`);
  return res.json();
}

// Links in a Note, in order: link attachments (Substack's link cards, which
// carry a title), then links in the rich text, then bare URLs in the text.
function noteLinks(c) {
  const out = [];
  for (const a of c.attachments || []) {
    const m = a.linkMetadata || a.link_metadata;
    if (a.type === "link" && m?.url) out.push({ uri: m.url, title: m.title || "" });
  }
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    for (const mark of n.marks || []) if (mark.type === "link" && mark.attrs?.href) out.push({ uri: mark.attrs.href, title: "" });
    for (const ch of n.content || []) walk(ch);
  };
  walk(typeof c.body_json === "string" ? safeParse(c.body_json) : c.body_json);
  for (const m of (c.body || "").matchAll(/https?:\/\/[^\s<>"')\]]+/g)) out.push({ uri: m[0], title: "" });
  return out;
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

const noteText = (c) =>
  (c.body || "").replace(/https?:\/\/[^\s<>"')\]]+/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ")
    .replace(/[\s:–—-]+$/, "").trim();

// When the API path fails or finds nothing, report whether the Notes page on
// theorybrief.com is reachable, as a possible second route in.
async function probeNotesPage() {
  try {
    const res = await fetch(NOTES_PAGE, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow", headers: { "User-Agent": UA } });
    const html = res.ok ? await res.text() : "";
    console.log(`  diagnostic: ${NOTES_PAGE} → HTTP ${res.status}, ${html.length} bytes` +
      (html ? `, preloaded data: ${/window\._preloads/.test(html) ? "yes" : "no"}` : ""));
  } catch (e) {
    console.log(`  diagnostic: ${NOTES_PAGE} → ${e.message}`);
  }
}

async function main() {
  const state = JSON.parse(readFileSync(cursorPath, "utf8"));
  const since = state.since;
  if (!since) throw new Error(`${cursorPath}: missing "since"`);

  let userId = state.userId;
  let items = [];
  const errors = [];
  for (const API of APIS) {
    try {
      if (!userId) {
        userId = (await getJson(`${API}/user/${HANDLE}/public_profile`)).id;
        if (!userId) throw new Error("profile has no id");
        console.log(`Substack user id for @${HANDLE}: ${userId}`);
      }
      const got = [];
      let cursor;
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await getJson(`${API}/reader/feed/profile/${userId}` + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""));
        const batch = data.items || [];
        got.push(...batch);
        cursor = data.nextCursor;
        const oldest = batch.at(-1)?.comment?.date || batch.at(-1)?.context?.timestamp;
        if (!cursor || !oldest || oldest <= since) break;
      }
      items = got;
      console.log(`Read Substack Notes via ${new URL(API).host}.`);
      errors.length = 0;
      break;
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length) {
    console.log(`::warning::Couldn't read Substack Notes (${errors.join("; ")}); trying again next run.`);
    await probeNotesPage();
    return;
  }

  const kinds = {};
  for (const it of items) kinds[it.context?.type || it.type || "?"] = (kinds[it.context?.type || it.type || "?"] || 0) + 1;
  console.log(`Substack feed: ${items.length} item(s) ${JSON.stringify(kinds)}`);

  const src = readFileSync(queuePath, "utf8");
  const known = new Set([...knownLinks(src), ...knownLinks(readFileSync(readingPath, "utf8"))]);
  let newest = since;
  let mine = 0;
  const added = [];
  for (const it of items) {
    const c = it.comment;
    if (!c || String(c.user_id) !== String(userId)) continue;
    if (/restack/i.test(it.context?.type || "")) continue;
    if (c.ancestor_path || it.parentComments?.length) continue; // replies
    const created = c.date;
    if (!created || created <= since) continue;
    mine++;
    if (created > newest) newest = created;
    const link = noteLinks(c).find((l) => isReadingLink(l.uri));
    if (!link) continue;
    const key = sameLinkKey(link.uri);
    if (known.has(key)) continue;
    known.add(key);
    const host = new URL(link.uri).hostname;
    added.push({
      created,
      date: osloDate(created),
      link: await cleanLink(link.uri),
      title: link.title ? stripSiteName(clean(link.title), "", host) : "",
      note: noteText(c),
      source: "Substack Note",
      publish: false,
    });
  }

  if (!items.length || (!mine && !state.userId)) await probeNotesPage();
  if (!added.length) {
    console.log(`No new links in Substack Notes since ${since} (${mine} new Note(s) of mine).`);
    return;
  }
  writeFileSync(queuePath, insertItems(src, added));
  // userId is saved too, so later runs skip the profile lookup.
  writeFileSync(cursorPath, JSON.stringify({ ...state, userId, since: newest }, null, 2) + "\n");
  console.log(`${queuePath}: queued ${added.length} link(s) from Substack Notes.`);
}

await main();
