/*
 * Shared canonical-outlet greenlist for the four RSS monitors.
 * Used to preferentially rank stories from the listed outlets ahead of
 * less-known sources before slicing to maxItems. Lower-tier outlets are
 * only kept if greenlisted items don't fill the card.
 *
 * Each entry is a lowercase substring matched against the normalized
 * source name. Normalization strips a leading "the " and lowercases.
 * The list intentionally includes a few aliases (NYT, WSJ, AP, etc.)
 * since Google News varies on how it labels outlets.
 */
(function () {
  const GREENLIST = [
    // English-language wires & majors
    'new york times', 'nytimes',
    'washington post',
    'wall street journal', 'wsj',
    'financial times', 'ft.com',
    'bloomberg',
    'guardian',
    'reuters',
    'associated press', 'ap news',
    'bbc news', 'bbc.com', 'bbc.co.uk',

    // European broadsheets
    'le monde diplomatique',
    'le monde',
    'der spiegel', 'spiegel',

    // Magazines & long-form
    'economist',
    'atlantic',
    'new yorker',
    'harper',                // matches "Harper's Magazine"
    'new york review',       // NYRB
    'london review',         // LRB
    'n+1',
    'jacobin',

    // Foreign-affairs / policy
    'foreign affairs',
    'foreign policy',

    // Investigative & long-form
    'propublica',
    'intercept',

    // Tech-press majors
    'mit technology review',
    'mit tech review',
    'the information',
    'wired',

    // Norwegian (sociologist's home market)
    'klassekampen',
    'morgenbladet',
    'aftenposten',
    'nrk',

    // Space-press
    'spacenews', 'space news',

    // Global English
    'al jazeera', 'aljazeera',

    // US politics & legal
    'the hill',
    'politico',
    'lawfare',

    // Business / markets
    'cnbc',
  ];

  // Lowercase + trim only. We intentionally do NOT strip a leading
  // "the " here: substring containment already handles it ("The New
  // York Times" → "the new york times" contains "new york times"), and
  // stripping would break outlets whose canonical name *is* "The X" —
  // e.g., The Hill, The Information, The Intercept — when the greenlist
  // entry itself contains "the ".
  function normalize(s) {
    return (s || '').toLowerCase().trim();
  }

  function isGreenlisted(source) {
    if (!source) return false;
    const n = normalize(source);
    if (!n) return false;
    return GREENLIST.some(g => n === g || n.includes(g));
  }

  /*
   * Redlist: outlets that must never appear in any monitor. Each entry is a
   * lowercase substring matched against the normalized source name AND the
   * lowercased item URL, so it catches both the Google-News source label and
   * the domain. Add sources here to hard-drop them everywhere.
   */
  const REDLIST = [
    'stadium rant', 'stadiumrant',
    'motley fool', 'fool.com',
    'livetipsportal',
    'space daily', 'spacedaily',
    '人民网财经',
  ];

  function isBlocked(item) {
    if (!item) return false;
    const n = normalize(item.source || item._sourceName || '');
    const u = (item.url || item.link || '').toLowerCase();
    return REDLIST.some(r => (n && n.includes(r)) || (u && u.includes(r)));
  }

  // Drop any redlisted items. Safe on undefined/empty.
  function filterBlocked(items) {
    return (items || []).filter(it => !isBlocked(it));
  }

  /*
   * Vault feed snapshots. The Vault (vault.victorshammas.com) pre-fetches every
   * panel's Google News feeds server-side every ~15 min and serves a merged,
   * deduped, newest-first JSON snapshot per panel. Monitors read that instead of
   * calling rss2json live — no rate limits, no per-client flakiness, and it works
   * regardless of blocked third-party-iframe storage. If the snapshot is
   * unreachable or older than maxAgeMs, callers fall back to the rss2json path.
   *
   * Snapshot shape: { status:"ok", monitor, panel, fetchedAt, lookbackDays,
   * partial, items:[{ title, link, pubDate, source, qi }] }.
   */
  const SNAPSHOT_BASE = 'https://vault.victorshammas.com/monitors';

  async function fetchSnapshot(monitor, panelId, maxAgeMs) {
    try {
      const url = `${SNAPSHOT_BASE}/${monitor}/${encodeURIComponent(panelId)}.json`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let r;
      try { r = await fetch(url, { cache: 'no-store', signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (!r || !r.ok) return null;
      const j = await r.json();
      if (!j || j.status !== 'ok' || !Array.isArray(j.items)) return null;
      if (maxAgeMs) {
        const age = Date.now() - new Date(j.fetchedAt || 0).getTime();
        if (!(age >= 0) || age > maxAgeMs) return null; // too stale → fall back
      }
      return j;
    } catch (e) { return null; }
  }

  // Regroup a snapshot's flat items into per-sub-query arrays (by `qi`) so the
  // monitors' existing merge/interleave logic works unchanged. Also mirrors the
  // server-provided `source` onto `_sourceName` for direct-feed panels.
  function snapshotResults(snap, numQueries) {
    const n = Math.max(1, numQueries || 1);
    const groups = Array.from({ length: n }, () => []);
    for (const it of (snap && snap.items) || []) {
      if (it && it._sourceName === undefined && it.source) it._sourceName = it.source;
      const qi = (typeof it.qi === 'number' && it.qi >= 0 && it.qi < n) ? it.qi : 0;
      groups[qi].push(it);
    }
    return groups;
  }

  /**
   * Time-decay promotion: each greenlisted item gets PROMOTION_HOURS of
   * synthetic age reduction. Effective score is `(now - pubDate) - boost`;
   * lower = ranked higher. Plain recency still drives the order; canonical
   * sources get a thumb on the scale.
   *
   * Examples (PROMOTION_HOURS = 12):
   *  - 30-min-old non-canonical scoop still beats a 6-hour-old NYT story
   *    (0.5 h vs effective -6 h... wait, -6 < 0.5, so NYT wins. Right —
   *    NYT's effective age is *negative* relative to 6h ago, ranking
   *    ahead of the 30-min scoop). Concretely: NYT at 6h old has score
   *    6 - 12 = -6; scoop at 0.5h has score 0.5. NYT wins.
   *  - 30-min-old scoop vs 24h-old NYT: scores 0.5 vs 12. Scoop wins.
   *  - 6-hour-old scoop vs 18-hour-old NYT: scores 6 vs 6. Tie → NYT
   *    wins by stable-sort source order (canonical first by insertion).
   *
   * Tune PROMOTION_HOURS up for more canonical-leaning, down for more
   * surprise from niche outlets. 0 = pure recency. Infinity = strict tier.
   */
  const PROMOTION_HOURS = 12;
  const PROMOTION_MS = PROMOTION_HOURS * 3600 * 1000;

  function rankByCanon(items, limit, dateKey) {
    dateKey = dateKey || 'pubDate';
    const now = Date.now();
    const scored = items.map(it => {
      const t = new Date(it[dateKey] || 0).getTime();
      const age = now - (t || 0);
      const boost = isGreenlisted(it.source || it._sourceName) ? PROMOTION_MS : 0;
      return { it, score: age - boost };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit).map(s => s.it);
  }

  window.MonitorCanon = { GREENLIST, REDLIST, PROMOTION_HOURS, normalize, isGreenlisted, isBlocked, filterBlocked, fetchSnapshot, snapshotResults, rankByCanon };
})();
