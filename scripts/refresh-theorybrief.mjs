import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ARCHIVE_URL = 'https://www.theorybrief.com/api/v1/archive';
export const PUBLISHED_URL = 'https://victorshammas.com/feeds/theorybrief.json';
const SNAPSHOT_PATH = fileURLToPath(new URL('../static/feeds/theorybrief.json', import.meta.url));
const MAX_POSTS = 1000;

function validPost(post) {
  if (!post || typeof post.title !== 'string' || !post.title.trim() ||
      typeof post.description !== 'string' || typeof post.pubDate !== 'string' ||
      !Number.isFinite(Date.parse(post.pubDate))) return false;
  try {
    const url = new URL(post.link);
    return url.protocol === 'https:' && url.hostname === 'www.theorybrief.com' &&
      !url.username && !url.password && url.pathname.startsWith('/p/');
  } catch { return false; }
}

function validSnapshot(snapshot) {
  return snapshot?.version === 1 && typeof snapshot.fetchedAt === 'string' &&
    Number.isFinite(Date.parse(snapshot.fetchedAt)) &&
    Array.isArray(snapshot.posts) && snapshot.posts.length > 0 &&
    snapshot.posts.length <= MAX_POSTS && snapshot.posts.every(validPost);
}

async function fetchJSON(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

export async function fetchArchive(fetchImpl = fetch) {
  const posts = [];
  const seen = new Set();
  // Bound the entire refresh, including pagination, so an outage cannot stall deployment.
  const signal = AbortSignal.timeout(60_000);
  while (posts.length < MAX_POSTS) {
    const url = `${ARCHIVE_URL}?sort=new&limit=50&offset=${posts.length}`;
    const batch = await fetchJSON(url, fetchImpl, signal);
    if (!Array.isArray(batch)) throw new Error('Archive response is not an array');
    if (batch.length === 0) {
      if (!posts.length) throw new Error('Archive is empty');
      return posts;
    }
    for (const item of batch) {
      const post = {
        title: item?.title,
        link: item?.canonical_url,
        description: item?.subtitle || item?.description || item?.search_engine_description || '',
        pubDate: item?.post_date,
      };
      if (!validPost(post)) throw new Error('Archive contains an invalid post');
      if (seen.has(post.link)) throw new Error('Archive pagination repeated a post');
      seen.add(post.link);
      posts.push(post);
    }
    // Continue until an empty page: the API can return fewer than the requested limit.
  }
  throw new Error(`Archive exceeded the ${MAX_POSTS}-post limit`);
}

export async function refreshSnapshot({
  snapshotPath = SNAPSHOT_PATH, fetchImpl = fetch, now = () => new Date(), logger = console,
} = {}) {
  let snapshot;
  try {
    const local = JSON.parse(await readFile(snapshotPath, 'utf8'));
    if (validSnapshot(local)) snapshot = local;
  } catch { /* The first refresh can bootstrap a missing file. */ }

  // Deploy builds do not commit generated data. Recover the last published success
  // before refreshing, so later outages do not revert to the initial checked-in seed.
  try {
    const published = await fetchJSON(PUBLISHED_URL, fetchImpl, AbortSignal.timeout(15_000));
    if (!validSnapshot(published)) throw new Error('Published snapshot is invalid');
    if (!snapshot || Date.parse(published.fetchedAt) > Date.parse(snapshot.fetchedAt)) {
      snapshot = published;
    }
  } catch (error) {
    logger.warn(`Published Theory Brief snapshot unavailable: ${error.message}`);
  }

  let refreshed = false;
  try {
    const posts = await fetchArchive(fetchImpl);
    snapshot = { version: 1, fetchedAt: now().toISOString(), posts };
    refreshed = true;
  } catch (error) {
    if (!snapshot) throw new Error(`No usable Theory Brief snapshot: ${error.message}`);
    logger.warn(`Theory Brief refresh failed (${error.message}); keeping ${snapshot.fetchedAt}.`);
  }

  // Write only a complete, validated snapshot, never a partial archive or an error page.
  await mkdir(dirname(snapshotPath), { recursive: true });
  const temporaryPath = `${snapshotPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(temporaryPath, snapshotPath);
  logger.log(`${refreshed ? 'Refreshed' : 'Retained'} ${snapshot.posts.length} Theory Brief posts.`);
  return { refreshed, snapshot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  refreshSnapshot().catch(error => { console.error(error.message); process.exitCode = 1; });
}
