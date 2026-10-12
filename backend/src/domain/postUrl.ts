/**
 * Post URL validation and canonicalization (D11).
 *
 * A submission's `normalizedUrl` is globally unique, so two links that point at
 * the same post must normalize to the exact same string. Normalization keeps the
 * platform's post/video id verbatim (case preserved) and discards everything
 * else: scheme, `www`, username prefixes, query strings, hashes and trailing
 * slashes.
 */

/** Platforms a campaign can target. */
export type Platform = 'instagram' | 'youtube';

/** Outcome of validating a submitted post URL. */
export type PostUrlResult = { ok: true; normalized: string } | { ok: false; reason: string };

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

const INSTAGRAM_POST_TYPES = new Set(['p', 'reel', 'reels', 'tv']);
const INSTAGRAM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl.trim());
  } catch {
    return null;
  }
}

/** Path segments with empty entries (leading/trailing slashes) removed. */
function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0);
}

function normalizeInstagram(url: URL): PostUrlResult {
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: 'URL host is not an Instagram host' };
  }

  const segments = splitPath(url.pathname);
  const prefixed = segments.length === 3;
  if (segments.length !== 2 && !prefixed) {
    return { ok: false, reason: 'URL is not a link to an Instagram post, reel or IGTV video' };
  }

  // Length is 2 (`/<type>/<id>`) or 3 (`/<username>/<type>/<id>`), so both
  // indices below are always present.
  const type = segments[prefixed ? 1 : 0] as string;
  const id = segments[prefixed ? 2 : 1] as string;
  if (!INSTAGRAM_POST_TYPES.has(type) || !INSTAGRAM_ID_PATTERN.test(id)) {
    return { ok: false, reason: 'URL is not a link to an Instagram post, reel or IGTV video' };
  }

  return { ok: true, normalized: `https://instagram.com/${type}/${id}` };
}

function normalizeYouTube(url: URL): PostUrlResult {
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    return { ok: false, reason: 'URL host is not a YouTube host' };
  }

  // youtu.be/<id> — one path segment, no query.
  if (host === 'youtu.be') {
    const id = splitPath(url.pathname)[0];
    if (id === undefined || !YOUTUBE_ID_PATTERN.test(id)) {
      return { ok: false, reason: 'YouTube video id is missing or invalid' };
    }
    return { ok: true, normalized: `https://youtube.com/watch?v=${id}` };
  }

  const segments = splitPath(url.pathname);

  // /watch?v=<id>
  if (segments[0] === 'watch') {
    const id = url.searchParams.get('v');
    if (id === null || !YOUTUBE_ID_PATTERN.test(id)) {
      return { ok: false, reason: 'YouTube video id is missing or invalid' };
    }
    return { ok: true, normalized: `https://youtube.com/watch?v=${id}` };
  }

  // /shorts/<id> — normalizes to the same watch URL so one video cannot be
  // submitted twice.
  if (segments[0] === 'shorts') {
    const id = segments[1];
    if (id === undefined || !YOUTUBE_ID_PATTERN.test(id)) {
      return { ok: false, reason: 'YouTube video id is missing or invalid' };
    }
    return { ok: true, normalized: `https://youtube.com/watch?v=${id}` };
  }

  return { ok: false, reason: 'URL is not a link to a YouTube video or Short' };
}

/**
 * Validate a post URL for the given campaign platform and return its canonical
 * form. Rejects malformed URLs, non-http(s) protocols, the wrong platform's
 * hosts and links without a usable post/video id.
 */
export function validateAndNormalizePostUrl(rawUrl: string, platform: Platform): PostUrlResult {
  const url = parseUrl(rawUrl);
  if (url === null) {
    return { ok: false, reason: 'URL is missing or malformed' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'URL must use http or https' };
  }

  return platform === 'instagram' ? normalizeInstagram(url) : normalizeYouTube(url);
}
