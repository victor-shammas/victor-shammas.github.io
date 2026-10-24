// Shared helpers for the reading-log scripts (fill-reading-titles.mjs,
// import-bluesky-reading.mjs).

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
    return u.hostname.replace(/^www\./, "").toLowerCase() + u.pathname.replace(/\/+$/, "") + (q ? "?" + q : "");
  } catch {
    return url.trim();
  }
}
