import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ARCHIVE_URL, PUBLISHED_URL, refreshSnapshot } from './refresh-theorybrief.mjs';

const item = (slug) => ({
  title: `Post ${slug}`, canonical_url: `https://www.theorybrief.com/p/${slug}`,
  subtitle: 'A description', post_date: '2026-10-01T12:00:00Z',
});
const snapshot = (date = '2026-10-01T12:00:00Z') => ({
  version: 1, fetchedAt: date,
  posts: [{ title: 'Saved post', link: 'https://www.theorybrief.com/p/saved',
    description: 'Saved description', pubDate: date }],
});
const response = (data) => ({ ok: true, json: async () => data });
const quiet = { warn() {}, log() {} };

async function fixture(t, seed = snapshot()) {
  const directory = await mkdtemp(join(tmpdir(), 'theorybrief-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotPath = join(directory, 'theorybrief.json');
  if (seed) await writeFile(snapshotPath, JSON.stringify(seed));
  return { snapshotPath, logger: quiet };
}

test('refreshes all pages, including short pages, and writes only normalized metadata', async t => {
  const options = await fixture(t);
  const offsets = [];
  const result = await refreshSnapshot({ ...options, fetchImpl: async (url, { signal }) => {
    assert.ok(signal instanceof AbortSignal);
    if (url === PUBLISHED_URL) return response(snapshot());
    assert.ok(url.startsWith(ARCHIVE_URL));
    const offset = Number(new URL(url).searchParams.get('offset'));
    offsets.push(offset);
    return response(offset < 2 ? [{ ...item(String(offset)), body_html: 'not saved' }] : []);
  }});
  assert.equal(result.refreshed, true);
  assert.deepEqual(offsets, [0, 1, 2]);
  assert.equal(result.snapshot.posts.length, 2);
  assert.equal(result.snapshot.posts[0].body_html, undefined);
  assert.deepEqual(JSON.parse(await readFile(options.snapshotPath)), result.snapshot);
});

test('retains even an old saved snapshot when both services are offline', async t => {
  const seed = snapshot('2024-01-01T00:00:00Z');
  const options = await fixture(t, seed);
  const result = await refreshSnapshot({ ...options, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(result.refreshed, false);
  assert.deepEqual(result.snapshot, seed);
});

test('recovers the latest published snapshot instead of reverting to the committed seed', async t => {
  const options = await fixture(t);
  const published = snapshot('2026-10-20T00:00:00Z');
  const result = await refreshSnapshot({ ...options, fetchImpl: async url => {
    if (url === PUBLISHED_URL) return response(published);
    return { ok: false, status: 503 };
  }});
  assert.deepEqual(result.snapshot, published);
  assert.deepEqual(JSON.parse(await readFile(options.snapshotPath)), published);
});

test('does not replace the saved archive with partially fetched posts', async t => {
  const options = await fixture(t);
  const result = await refreshSnapshot({ ...options, fetchImpl: async url => {
    if (url !== PUBLISHED_URL && new URL(url).searchParams.get('offset') === '0') {
      return response([item('new')]);
    }
    throw new Error('request timed out');
  }});
  assert.equal(result.refreshed, false);
  assert.deepEqual(result.snapshot, snapshot());
});

for (const [name, data] of [
  ['empty archive', []],
  ['error object', { error: 'unavailable' }],
  ['unsafe URL', [{ ...item('unsafe'), canonical_url: 'javascript:alert(1)' }]],
  ['invalid date', [{ ...item('date'), post_date: 'bad date' }]],
]) {
  test(`retains saved posts on ${name}`, async t => {
    const options = await fixture(t);
    const result = await refreshSnapshot({ ...options, fetchImpl: async () => response(data) });
    assert.equal(result.refreshed, false);
    assert.deepEqual(result.snapshot, snapshot());
  });
}

test('retains saved posts when an upstream challenge returns HTML', async t => {
  const options = await fixture(t);
  const result = await refreshSnapshot({ ...options, fetchImpl: async () => ({
    ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); },
  }) });
  assert.equal(result.refreshed, false);
  assert.deepEqual(result.snapshot, snapshot());
});

test('stops repeated pagination without replacing saved posts', async t => {
  const options = await fixture(t);
  let calls = 0;
  const result = await refreshSnapshot({ ...options, fetchImpl: async () => {
    calls++;
    return response([item('repeated')]);
  }});
  assert.equal(calls, 3); // published snapshot + two archive pages
  assert.equal(result.refreshed, false);
});

test('fails clearly when neither a saved snapshot nor a live archive is available', async t => {
  const options = await fixture(t, null);
  await assert.rejects(refreshSnapshot({ ...options, fetchImpl: async () => { throw new Error('offline'); } }),
    /No usable Theory Brief snapshot/);
});
