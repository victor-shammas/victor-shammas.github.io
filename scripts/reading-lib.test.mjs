import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { cleanLink, linkFromShare, sameLinkKey, stripTracking } from './reading-lib.mjs';

test('strips FT share parameters and numeric share anchors', () => {
  assert.equal(
    stripTracking('https://www.ft.com/content/dfe64d5e-f5f3-444f-a233-a516483fa6f0?syn-25a6b1a6=1#30670061'),
    'https://www.ft.com/content/dfe64d5e-f5f3-444f-a233-a516483fa6f0');
});

test('strips well-known tracking parameters but keeps the rest byte for byte', () => {
  assert.equal(stripTracking('https://example.com/a?utm_source=x&id=1&fbclid=abc'), 'https://example.com/a?id=1');
  assert.equal(stripTracking('https://example.com/a?q=a+b%2Cc&UTM_Medium=x'), 'https://example.com/a?q=a+b%2Cc');
  assert.equal(stripTracking('https://example.com/a?mc_cid=1&mc_eid=2'), 'https://example.com/a');
  assert.equal(stripTracking('https://example.com/a#:~:text=some%20words'), 'https://example.com/a');
});

test('keeps gift tokens, unknown parameters, other sites\' syn- parameters, and route fragments', () => {
  for (const url of [
    'https://www.ft.com/content/abc?accessToken=zwAAA&sharetype=gift&token=123',
    'https://www.nytimes.com/2026/10/20/x.html?unlocked_article_code=1.abc&smid=url-share',
    'https://example.com/a?syn-25a6b1a6=1',
    'https://example.com/app#/articles/42',
    'https://example.com/app#!/articles/42',
    'https://en.wikipedia.org/wiki/Tesla,_Inc.#History',
    'https://example.com/a?ref=homepage',
  ]) assert.equal(stripTracking(url), url);
});

test('a URL with nothing to strip comes back exactly as given', () => {
  for (const url of ['HTTPS://Example.com', 'https://example.com/ø?a=b c', 'not a url']) {
    assert.equal(stripTracking(url), url);
  }
});

test('stripped links still dedupe against their clean form', () => {
  assert.equal(
    sameLinkKey('https://ft.com/content/abc?syn-25a6b1a6=1#30670061'),
    sameLinkKey('https://www.ft.com/content/abc'));
});

test('cleanLink keeps the original when the cleaned link stops loading', async t => {
  // A site that (unusually) needs its "utm_source": 404 without it.
  const server = createServer((req, res) => {
    res.statusCode = req.url.includes('utm_source=') || !req.url.startsWith('/needs') ? 200 : 404;
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const log = console.log;
  console.log = () => {};
  t.after(() => { console.log = log; });

  assert.equal(await cleanLink(`${base}/needs?utm_source=x`), `${base}/needs?utm_source=x`);
  assert.equal(await cleanLink(`${base}/fine?utm_source=x&id=1`), `${base}/fine?id=1`);
});

test('cleanLink uses the cleaned link when neither can be fetched', async () => {
  // Port 9 on localhost: nothing listens, both fetches fail.
  assert.equal(await cleanLink('http://127.0.0.1:9/a?fbclid=x'), 'http://127.0.0.1:9/a');
});

test('linkFromShare finds the URL in shared text', () => {
  assert.equal(linkFromShare('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(linkFromShare('  Some headline https://example.com/a. '), 'https://example.com/a');
  assert.equal(linkFromShare('Read this (https://example.com/a)'), 'https://example.com/a');
  assert.equal(linkFromShare('https://en.wikipedia.org/wiki/Tesla_(unit)'), 'https://en.wikipedia.org/wiki/Tesla_(unit)');
  assert.equal(linkFromShare('see https://en.wikipedia.org/wiki/Tesla_(unit), ok'), 'https://en.wikipedia.org/wiki/Tesla_(unit)');
  assert.equal(linkFromShare('“https://example.com/a”'), 'https://example.com/a');
  for (const bad of ['', 'no link here', 'javascript:alert(1)', 'ftp://example.com/a', 'file:///etc/passwd'])
    assert.equal(linkFromShare(bad), null);
});
