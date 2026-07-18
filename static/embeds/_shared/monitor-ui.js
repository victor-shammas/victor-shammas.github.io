/*
 * Shared UI helpers for the monitor embeds (both the RSS monitors and the
 * academic-journal monitor). Kept separate from greenlist.js's canon-ranking
 * logic so every monitor can load it uniformly and share ONE implementation.
 *
 * Exposed as window.MonitorUI.
 */
(function () {
  /*
   * Detect in-app / embedded browsers (Messenger, Instagram, Facebook,
   * TikTok, etc.). These WKWebView-based views don't honor programmatic
   * blob downloads (`<a download>.click()`): instead of saving the file they
   * navigate to the blob: URL and render it inline, hijacking the page.
   * Feature detection is unreliable here (they report `download` in <a> but
   * ignore it), so we sniff the known UA tokens.
   */
  function isInAppBrowser() {
    const ua = (navigator.userAgent || '');
    return /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|Twitter|TikTok|musical_ly|Snapchat|LinkedInApp|Pinterest|MicroMessenger|GSA\//i.test(ua);
  }

  /*
   * Lightweight, dependency-free toast. Injects its own styles once and shows
   * a brief bottom-centered message. Used to explain gracefully when an action
   * (e.g. a file download) can't work in the current browser.
   */
  function showToast(message, ms) {
    let host = document.getElementById('mui-toast-host');
    if (!host) {
      const style = document.createElement('style');
      style.textContent =
        '#mui-toast-host{position:fixed;left:50%;bottom:1.25rem;transform:translateX(-50%);z-index:99999;' +
        'display:flex;flex-direction:column;gap:.5rem;align-items:center;pointer-events:none;' +
        'max-width:min(92vw,32rem);padding:0 .5rem}' +
        '.mui-toast{pointer-events:auto;background:#1f1f1f;color:#f5f5f5;font-size:.85rem;line-height:1.4;' +
        'padding:.7rem 1rem;border-radius:.5rem;box-shadow:0 4px 16px rgba(0,0,0,.28);' +
        'text-align:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s}' +
        '.mui-toast.mui-show{opacity:1;transform:translateY(0)}';
      document.head.appendChild(style);
      host = document.createElement('div');
      host.id = 'mui-toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'mui-toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('mui-show'));
    const life = ms || 5200;
    setTimeout(() => {
      el.classList.remove('mui-show');
      setTimeout(() => el.remove(), 250);
    }, life);
  }

  /*
   * Single guard for every download entry point. Returns true — and shows an
   * explanatory toast — when the current browser can't perform blob downloads
   * (an in-app / embedded webview). Call sites should do:
   *   if (window.MonitorUI && MonitorUI.blockDownloadInApp()) return;
   * before building a download.
   */
  function blockDownloadInApp(message) {
    if (!isInAppBrowser()) return false;
    showToast(message || 'This in-app browser can’t save downloads. Open the page in Safari or Chrome to export.');
    return true;
  }

  window.MonitorUI = { isInAppBrowser, showToast, blockDownloadInApp };
})();
