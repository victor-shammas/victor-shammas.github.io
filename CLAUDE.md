# CLAUDE.md — victorshammas.com

Notes for working on this site (a Hugo static site deployed to GitHub Pages).

## RSS News Monitors

Five monitor dashboards live at `/tools/<name>-monitor/`, each an iframe of a
standalone page in `static/embeds/<name>-monitor/index.html`:
`ai`, `space`, `tech`, `leftpolitics`, `rightwing`. They're also embedded
cross-site (e.g. on lab.hrmn.ai).

### Editing what a monitor tracks — the workflow

**`static/embeds/_shared/monitors.config.json` is the single source of truth**
for every panel's queries plus the greenlist and redlist. The embeds'
`PANELS`/`PARTIES` arrays and `greenlist.js`'s `GREENLIST`/`REDLIST` are
**generated** from it — do not hand-edit those blocks (they sit between
`// @genstart` / `// @genend` markers).

To add a query, block a source, tweak a lookback, add/remove a panel:

1. Edit `static/embeds/_shared/monitors.config.json`.
2. Run `npm run gen:monitors` (regenerates the marked blocks in the embeds +
   `greenlist.js`).
3. Commit **both** the config and the regenerated files. CI
   (`npm run gen:monitors:check`, in `deploy.yml`) fails the build if they're
   out of sync, so you can't ship a hand-edit that diverges.

Common edits:
- **Block a source everywhere:** add a lowercase substring to `redlist` (matched
  against the source name *and* the item URL). One entry covers all monitors.
- **Change a panel's query:** edit its `q` (single query) or `queries` (array;
  strings, or `{hl,gl,q}` locale objects for Nordic-style interleave).
- **Boost canonical outlets:** add to `greenlist` (time-decay ranking).

The config feeds three consumers; all agree because they read the same file:
- **The embeds** (generated at author time, committed).
- **The Vault** (see below) fetches the published config each run.
- **The cross-monitor digest email** (`monitor_digest.py` in the vault repo,
  daily cron on the VPS) fetches the published config each run for the panel
  list + greenlist + redlist, then reads the Vault snapshots — a query or
  list edit reaches the next day's digest automatically.

### Where the feed data comes from — the Vault

The embeds do **not** call rss2json live in the normal path. The Vault
(`vault.victorshammas.com`, a separate Ubuntu VPS) pre-fetches every panel's
Google News feeds server-side every ~15 min (:07/:22/:37/:52) and serves a
merged/deduped/newest-first JSON snapshot per panel at:

```
https://vault.victorshammas.com/monitors/<monitor>/<panel>.json
```

Client logic (in each embed's `fetchPanel`/`fetchParty`, via
`MonitorCanon.fetchSnapshot`): read the Vault snapshot first; fall back to live
rss2json only if it's unreachable or its `fetchedAt` is older than ~45 min. This
is what makes the cards reliable even in a cross-site iframe (no rss2json
rate-limiting, no per-client flakiness, works with blocked third-party storage).

Consequences to remember:
- **The Vault auto-syncs from the config** (it fetches the published
  `monitors.config.json` each run), so a query change reaches it within one cron
  cycle — no manual re-sync needed.
- **The redlist/greenlist are applied client-side only.** The Vault serves raw
  merged items; `greenlist.js` (`filterBlocked`/`rankByCanon`) does the
  filtering/ranking in the browser. A blocked source still counts toward the
  Vault's 100-item/panel cap but is dropped before render.
- **rightwing's `bluesky` panel** (`type:"bluesky"`) isn't RSS and isn't on the
  Vault — it's fetched client-side. Leave it out of Vault expectations.
- **Cards don't auto-refresh on a timer** — only on page load (skipping panels
  with a <3h localStorage cache) or the ↻ / "Refresh All" buttons.

### Shared code

- `static/embeds/_shared/greenlist.js` → `window.MonitorCanon`: `GREENLIST`,
  `REDLIST`, `isGreenlisted`, `isBlocked`, `filterBlocked`, `rankByCanon`,
  `fetchSnapshot`, `snapshotResults`. (The two lists here are generated from the
  config.)
- `layouts/_default/embed.html` → the manila tab bar (AI · Space · Tech · Left ·
  Right) and the iframe wrapper.

## Reading log

`/reading/` is a running link log: `data/reading.yaml` (an `items` list of
`date`/`link`/`title`/`note`), edited only through the admin panel's
"Reading" collection, rendered by `layouts/shortcodes/reading.html` (newest
first, grouped by month, domain after the title, optional Markdown note
below). Same pattern as News, but a Sveltia *singleton* (sidebar → "Files")
so it opens straight into the editor. There's deliberately no phone/API
ingestion; the only automatic sources are my own Bluesky posts and Substack
Notes (below), and those go to a holding queue, not straight to the page.

`.github/workflows/import-reading-links.yml` runs hourly. First
`npm run import:bluesky` (`scripts/import-bluesky-reading.mjs`) reads
@victorshammas.com's public feed (official API, no auth); then
`npm run import:substack` (`scripts/import-substack-notes.mjs`) reads my
Substack Notes via the *undocumented* endpoints substack.com's web app uses
(`/api/v1/user/victorshammas/public_profile`, `/api/v1/reader/feed/profile/<id>`),
which may change or be blocked. substack.com 403s GitHub's runners, so it
falls back to the same paths on www.theorybrief.com (which lets them in). Each queues links from my own posts (not
reposts/restacks, quote posts, replies to others, my own sites, or links
already in the log or the queue, so a link shared on both appears once) at
the top of `data/reading-queue.yaml`, with the post text minus the URL as the
note, plus `source:` and `publish: false`. Links are cleaned first (`cleanLink`
in `reading-lib.mjs`): only a short list of known tracking parameters
(`utm_*`, `fbclid`, FT's `syn-…`, …) and share/highlight-only fragments
(`#123`, `#:~:text=`) are removed, the rest of the URL is kept byte for byte,
and if the cleaned link fails to load while the original loads, the original
is kept. Gift-link tokens and unknown parameters are never touched. Tests:
`npm run test:reading` (also run in `deploy.yml`). Each source warns and
skips if unreachable (the Substack one then also reports whether
theorybrief.com/notes is reachable, as a fallback route). Cursors live in
`data/reading-bluesky.json` / `data/reading-substack.json` and are only
committed with new items, so deleting a queued entry is permanent. The
job then runs the title filler (over both files) and commits; it only
redeploys if a title in the log itself was filled, since the site never
shows the queue.

**The queue** is the admin's "Reading queue" singleton. I edit an item, tick
"Publish" and save; `fill-reading-titles.yml` (which runs on pushes to either
file) first runs `npm run publish:reading` (`scripts/publish-reading-queue.mjs`),
which moves ticked items line-for-line to the top of `data/reading.yaml`
(dropping `publish`/`source`) and removes them from the queue, then fills
titles, commits, and redeploys. A ticked link already in the log is just
dropped from the queue (guards against a stale admin tab re-saving a
published item). Deleting an item from the queue discards it. Both reading
workflows share the `reading-log` concurrency group. Shared helpers (dedupe,
insertion, the line-based `itemBlocks` parser, skip list, title cleanup) are
in `scripts/reading-lib.mjs`.

RSS: `/reading/index.xml` (`layouts/_default/reading.rss.xml`, the 50 newest,
linking straight to each article; enabled in `content/reading.md`) and
`/blog/index.xml` (`layouts/blog/list.rss.xml`, 20 newest posts; enabled by the
`[[cascade]]` for `/blog` in `hugo.toml`). Both pages show a small RSS icon in
the page header (`layouts/partials/feed-link.html`, shown on any page with an
RSS output) and a `<link rel="alternate">`.

Titles can be left blank: `.github/workflows/fill-reading-titles.yml` runs
`npm run fill:reading` (`scripts/fill-reading-titles.mjs`, over both the log
and the queue) on every push that touches either file, fetches og:title/`<title>` for blank-titled links (dropping
a trailing " | Site Name" that matches og:site_name or the domain; links
with a DOI are looked up in Crossref first, since publishers like OUP 403
GitHub's runners), commits
them back, and dispatches `deploy.yml` (a GITHUB_TOKEN push doesn't trigger
deploys on its own). Typed or edited titles are never overwritten: only
blanks are filled, and the bot pushes fast-forward only (if main moved, it
re-reads the latest file and starts over, never merges). Unfetchable or
bot-wall titles stay blank and the page shows the domain.

## Blog ↔ The Theory Brief

The blog mirrors Theory Brief posts. `layouts/blog/single.html` ends each post
with "This piece also appears in *The Theory Brief*…", linking the original:
the `original:` front-matter URL if set (admin field "Theory Brief original";
`original: false` hides the line; an empty value counts as unset), else the
post in `static/feeds/theorybrief.json` with the same title (lowercased,
non-alphanumerics stripped). Pre-Substack posts simply get no line. Don't add
hand-written "Originally published in The Theory Brief" lines; credits to
other venues stay in the post body. The lookup lives in
`layouts/partials/theorybrief-original.html`, and the same URL is the post's
`<link rel="canonical">` (so the Substack copy is the one that ranks in
search) and keeps the post out of `sitemap.xml` (`layouts/sitemap.xml`).

## SEO

`layouts/_default/baseof.html` builds each page's head: the description
(`layouts/partials/meta-description.html`: front-matter `description`, else a
blog post's summary/deck, else the subtitle; the home page uses
`params.homeDescription`), Open Graph/Twitter preview tags with absolute image
URLs (the keynote photo when a page has no image), `<html lang>` from a
`lang` front-matter field (`nb` on the Norwegian page), and schema.org `Person`
JSON-LD on the home page (`layouts/partials/structured-data.html`; keep it to
facts shown on the site).

## Theory Brief footer

`static/feeds/theorybrief.json` is a checked-in seed of public post metadata.
Hugo embeds its posts directly in the Substack footer; the browser still picks
five at random, with no Substack/rss2json request or localStorage expiry.

`npm run refresh:theorybrief` refreshes the archive before each build. It first
recovers a newer snapshot from the currently published site, then fetches all
archive pages server-side. On an upstream failure it retains the most recent
valid snapshot without expiring it. Invalid or partially fetched archives never
replace saved posts. Deploy builds publish the refreshed JSON alongside the HTML
but do not commit it back to Git. Keep the checked-in seed for offline builds.

The deploy workflow also runs every six hours to pick up new posts without a
content commit (GitHub may delay scheduled runs). Run `npm run test:theorybrief`
for pagination, validation, and outage-retention tests.

## Deploys

- Push to `main` triggers `.github/workflows/deploy.yml` (Hugo build + Pagefind
  search index + `gen:monitors:check` + Pages deploy).
- **Transient Pages failure:** if a deploy fails at the "Deploy to GitHub Pages"
  step with `Deployment failed, try again later`, that's a GitHub backend blip,
  not a code problem — just re-run the failed job.

## Search

Full-site search (blog, pages, and full-text of every PDF in `static/pdfs/`) is
built with Pagefind in the deploy workflow (`scripts/build-search-index.mjs`);
PDF text extraction is cached weekly. Results render at `/search/`.
