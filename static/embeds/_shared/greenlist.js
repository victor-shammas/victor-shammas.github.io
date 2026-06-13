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

  function normalize(s) {
    return (s || '').toLowerCase().trim().replace(/^the\s+/, '');
  }

  function isGreenlisted(source) {
    if (!source) return false;
    const n = normalize(source);
    if (!n) return false;
    return GREENLIST.some(g => n === g || n.includes(g));
  }

  /**
   * Two-tier sort: greenlisted items (by date desc) first, others (by
   * date desc) after. Then slice to `limit`. Caller is responsible for
   * any further post-processing (e.g., trim to multiple of 3 for wide
   * card 3-col grid).
   */
  function rankByCanon(items, limit, dateKey) {
    dateKey = dateKey || 'pubDate';
    const ts = it => new Date(it[dateKey] || 0).getTime();
    const byDateDesc = (a, b) => ts(b) - ts(a);
    const green = [];
    const rest = [];
    for (const it of items) {
      (isGreenlisted(it.source || it._sourceName) ? green : rest).push(it);
    }
    green.sort(byDateDesc);
    rest.sort(byDateDesc);
    return [...green, ...rest].slice(0, limit);
  }

  window.MonitorCanon = { GREENLIST, normalize, isGreenlisted, rankByCanon };
})();
