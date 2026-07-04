# CLAUDE.md — victorshammas.com

Notes for working on this site (a Hugo static site deployed to GitHub Pages).

## RSS News Monitors

Five monitor dashboards live at `/tools/<name>-monitor/`, each an iframe of a
standalone page in `static/embeds/<name>-monitor/index.html`:
`ai`, `space`, `tech`, `leftpolitics`, `rightwing`. They're also embedded
cross-site (e.g. on hrmn.ai).

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

The config feeds two consumers; both agree because they read the same file:
- **The embeds** (generated at author time, committed).
- **The Vault** (see below) fetches the published config each run.

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
