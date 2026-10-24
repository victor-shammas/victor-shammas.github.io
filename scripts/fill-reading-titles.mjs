#!/usr/bin/env node
// Fill in blank titles in data/reading.yaml from each linked page's
// og:title / twitter:title / <title> (minus a trailing " | Site Name"), so a
// link can be logged from the admin panel by pasting just the URL.
//
// Only items with a missing or empty `title:` are touched; a title typed in
// the admin always wins. Lines are edited in place (no YAML
// re-serialization), so the CMS's quoting and formatting are untouched. If a
// page can't be fetched or only yields a bot-wall title ("Just a moment…"),
// the title stays blank and the site shows the link's domain instead; the
// next save retries it.
//
// Usage: node scripts/fill-reading-titles.mjs [path]   (default: data/reading.yaml)
// Run automatically by .github/workflows/fill-reading-titles.yml on every push.

import { readFileSync, writeFileSync } from "node:fs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 15_000;

// Titles that describe an error page or bot check, not the article.
const JUNK = /^(just a moment|attention required|access denied|forbidden|403\b|404\b|page not found|not found|error\b|robot check|are you a robot|are you human|security check|verify you are|captcha|subscribe to (read|continue)|sign in|log ?in\b|please enable (javascript|cookies))/i;

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—",
  hellip: "…", laquo: "«", raquo: "»", middot: "·",
};
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const clean = (s) => decode(s).replace(/\s+/g, " ").trim().slice(0, 300);

// Drop a trailing " | Site Name" (or " – ", " — ", " - ", " · ") when it's
// the site's own name: the page already shows the domain after each title.
// Only strips a suffix matching og:site_name or the domain, so a real
// subtitle ("Part 1 – The Beginning") is kept.
const squash = (s) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
function stripSiteName(title, siteName, host) {
  const m = title.match(/^(.+)\s+[|–—·•-]\s+(.+)$/);
  if (!m) return title;
  const suffix = squash(m[2]);
  const bare = (host || "").replace(/^www\./, "");
  const names = [siteName, bare, bare.split(".")[0]].filter(Boolean).map(squash);
  return names.includes(suffix) ? m[1].trim() : title;
}

function titleFromHtml(html, host) {
  const meta = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4];
    }
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (["og:title", "twitter:title", "og:site_name"].includes(key) && attrs.content && !meta[key]) {
      meta[key] = attrs.content;
    }
  }
  const t = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  for (const raw of [meta["og:title"], meta["twitter:title"], t && t[1]]) {
    const title = raw && clean(raw);
    if (title && !JUNK.test(title)) {
      return stripSiteName(title, meta["og:site_name"] && clean(meta["og:site_name"]), host);
    }
  }
  return "";
}

async function fetchTitle(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en,nb;q=0.8" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!/html/i.test(type)) throw new Error(`not HTML (${type || "no content-type"})`);
  // Read at most MAX_BYTES; the <head> is near the top.
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const charset = (type.match(/charset=([\w-]+)/i) || [])[1] || "utf-8";
  let decoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder("utf-8"); }
  return titleFromHtml(decoder.decode(Buffer.concat(chunks)), new URL(res.url || url).hostname);
}

const unquote = (v) => {
  v = v.trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  return v.trim();
};

async function main() {
  const path = process.argv[2] || "data/reading.yaml";
  const lines = readFileSync(path, "utf8").split("\n");
  const itemsIdx = lines.findIndex((l) => /^items:/.test(l));
  if (itemsIdx === -1) {
    console.log(`${path}: no top-level "items:" key; nothing to do.`);
    return;
  }
  const listIndent = (lines.slice(itemsIdx + 1).find((l) => /^\s*- /.test(l)) || "  - ").match(/^\s*/)[0];
  const keyIndent = listIndent + "  ";
  // A key belongs to the item when it sits at the item's key indentation
  // ("  - key:" or "    key:"); deeper lines are a multi-line note.
  const keyRe = (k) => new RegExp(`^(?:${listIndent}- |${keyIndent})${k}:(.*)$`);

  // Collect item blocks as [start, end) line ranges.
  const blocks = [];
  for (let i = itemsIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // next top-level key
    if (lines[i].startsWith(listIndent + "- ")) blocks.push({ start: i, end: lines.length });
    if (blocks.length > 1) blocks[blocks.length - 2].end = blocks[blocks.length - 1].start;
  }

  const edits = []; // { line, insert?: bool, text }
  for (const b of blocks) {
    let link = "", titleLine = -1, linkLine = -1, title = "";
    for (let i = b.start; i < b.end; i++) {
      const lm = lines[i].match(keyRe("link"));
      if (lm) { link = unquote(lm[1]); linkLine = i; }
      const tm = lines[i].match(keyRe("title"));
      if (tm) { title = unquote(tm[1]); titleLine = i; }
    }
    if (title || !/^https?:\/\//i.test(link)) continue;
    let found = "";
    try {
      found = await fetchTitle(link);
      if (!found) console.log(`  no usable title: ${link}`);
    } catch (e) {
      console.log(`  could not fetch ${link}: ${e.message}`);
    }
    if (!found) continue;
    console.log(`  ${link}\n    → ${found}`);
    // JSON string syntax is a valid YAML double-quoted scalar.
    const value = JSON.stringify(found);
    if (titleLine !== -1) {
      const prefix = lines[titleLine].match(/^(\s*(?:- )?)title:/)[1];
      edits.push({ line: titleLine, text: `${prefix}title: ${value}` });
    } else {
      edits.push({ line: linkLine, insert: true, text: `${keyIndent}title: ${value}` });
    }
  }

  if (!edits.length) {
    console.log(`${path}: no blank titles to fill.`);
    return;
  }
  // Apply bottom-up so earlier line numbers stay valid.
  for (const e of edits.sort((a, b) => b.line - a.line)) {
    if (e.insert) lines.splice(e.line + 1, 0, e.text);
    else lines[e.line] = e.text;
  }
  writeFileSync(path, lines.join("\n"));
  console.log(`${path}: filled ${edits.length} title(s).`);
}

await main();
