// Shared helpers for the reading-log scripts (fill-reading-titles.mjs,
// import-bluesky-reading.mjs, import-substack-notes.mjs,
// publish-reading-queue.mjs).

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—",
  hellip: "…", laquo: "«", raquo: "»", middot: "·",
};
export const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
export const clean = (s) => decode(s).replace(/\s+/g, " ").trim().slice(0, 300);

// Drop a trailing " | Site Name" (or " – ", " — ", " - ", " · ") when it's
// the site's own name: the page already shows the domain after each title.
// Only strips a suffix matching og:site_name or the domain (or whose
// initials spell it: "London Review of Books" on lrb.co.uk), so a real
// subtitle ("Part 1 – The Beginning") is kept.
const squash = (s) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
export function stripSiteName(title, siteName, host) {
  const m = title.match(/^(.+)\s+[|–—·•-]\s+(.+)$/);
  if (!m) return title;
  const suffix = squash(m[2]);
  const bare = (host || "").replace(/^www\./, "");
  const label = squash(bare.split(".")[0]);
  const names = [siteName, bare, label].filter(Boolean).map(squash);
  const initials = m[2].split(/\s+/).filter((w) => !/^(the|of|and|for|&)$/i.test(w)).map((w) => w[0]).join("");
  const isInitials = label.length >= 2 && squash(initials) === label;
  return names.includes(suffix) || isInitials ? m[1].trim() : title;
}

const TRACKING = /^utm_|^(fbclid|gclid|igshid|mc_cid|mc_eid|ref_src)$/i;

// The URL without tracking parameters (utm_*, fbclid, …).
export function stripTracking(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

// For spotting the same link twice: ignore scheme, "www.", trailing slash,
// fragment and tracking parameters.
export function sameLinkKey(url) {
  try {
    const u = new URL(stripTracking(url));
    const q = u.searchParams.toString();
    return u.host.replace(/^www\./, "").toLowerCase() + u.pathname.replace(/\/+$/, "") + (q ? "?" + q : "");
  } catch {
    return url.trim();
  }
}

// My own sites aren't "reading"; links to Bluesky posts aren't either.
const SKIP_HOSTS = ["victorshammas.com", "theorybrief.com", "hrmn.ai",
  "bsky.app", "bsky.social", "go.bsky.app"];

// An http(s) link to somewhere worth logging.
export function isReadingLink(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    // Substack Notes and profiles, but not newsletters (*.substack.com).
    if (/^(www\.)?substack\.com$/.test(h) && /^\/(@|profile\/|notes?(\/|$)|chat)/.test(u.pathname)) return false;
    return !SKIP_HOSTS.some((s) => h === s || h.endsWith("." + s));
  } catch {
    return false;
  }
}

// Oslo calendar date, matching how the admin's date field is used.
export const osloDate = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));

// sameLinkKey()s of every link already in a reading.yaml source.
export const knownLinks = (src) =>
  new Set([...src.matchAll(/^\s*(?:- )?link:\s*(.+)$/gm)]
    .map((m) => sameLinkKey(m[1].trim().replace(/^(['"])(.*)\1$/, "$2"))));

// The `items:` list of a reading-log file, read line by line (no YAML
// re-serialization, so the CMS's quoting and formatting survive): the
// `items:` line, the list's indentation, and each item as a [start, end)
// line range (trailing blank lines excluded). null if there's no `items:`.
export function itemBlocks(lines) {
  const itemsIdx = lines.findIndex((l) => /^items:/.test(l));
  if (itemsIdx === -1) return null;
  const listIndent = (lines.slice(itemsIdx + 1).find((l) => /^\s*- /.test(l)) || "  - ").match(/^\s*/)[0];
  const blocks = [];
  let i = itemsIdx + 1;
  for (; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // next top-level key
    if (lines[i].startsWith(listIndent + "- ")) {
      if (blocks.length) blocks.at(-1).end = i;
      blocks.push({ start: i, end: lines.length });
    }
  }
  if (blocks.length) blocks.at(-1).end = i;
  for (const b of blocks) while (b.end > b.start + 1 && !lines[b.end - 1].trim()) b.end--;
  return { itemsIdx, listIndent, keyIndent: listIndent + "  ", blocks };
}

// Insert items ({created, date, link, title, note, source?, publish?}) at
// the top of the list, newest first (where the admin adds too). Returns the
// new file text.
export function insertItems(src, items) {
  const sorted = [...items].sort((a, b) => (a.created < b.created ? 1 : -1));
  // The admin may save an emptied list as "{}" or drop the key.
  if (!src.trim() || src.trim() === "{}") src = "items: []\n";
  else if (!/^items:/m.test(src)) src = src.replace(/\n*$/, "\nitems:\n");
  const lines = src.split("\n");
  const i = lines.findIndex((l) => /^items:/.test(l));
  lines[i] = "items:"; // also turns an empty "items: []" into a list
  const listIndent = (lines.slice(i + 1).find((l) => /^\s*- /.test(l)) || "  - ").match(/^\s*/)[0];
  const k = listIndent + "  ";
  // JSON string syntax is a valid YAML double-quoted scalar.
  const q = (s) => JSON.stringify(s);
  const block = sorted.flatMap((a) => {
    console.log(`  + ${a.date} ${a.link}${a.title ? `\n    → ${a.title}` : ""}`);
    return [
      `${listIndent}- date: ${a.date}`,
      `${k}link: ${q(a.link)}`,
      `${k}title: ${a.title ? q(a.title) : "''"}`,
      ...(a.note ? [`${k}note: ${q(a.note)}`] : []),
      ...(a.source ? [`${k}source: ${q(a.source)}`] : []),
      ...(a.publish === false ? [`${k}publish: false`] : []),
    ];
  });
  lines.splice(i + 1, 0, ...block);
  return lines.join("\n");
}
