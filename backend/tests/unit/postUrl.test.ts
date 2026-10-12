import { validateAndNormalizePostUrl } from '../../src/domain/postUrl';

describe('validateAndNormalizePostUrl — Instagram', () => {
  it.each([
    'https://www.instagram.com/p/ABC123/?igsh=xyz',
    'https://instagram.com/p/ABC123',
    'http://instagram.com/p/ABC123/',
    'https://instagram.com/p/ABC123#comments',
  ])('normalizes the post link %s to one canonical URL', (url) => {
    expect(validateAndNormalizePostUrl(url, 'instagram')).toEqual({
      ok: true,
      normalized: 'https://instagram.com/p/ABC123',
    });
  });

  it('preserves the id case and keeps the path type', () => {
    expect(
      validateAndNormalizePostUrl('https://www.instagram.com/reel/AbC-123_x', 'instagram'),
    ).toEqual({ ok: true, normalized: 'https://instagram.com/reel/AbC-123_x' });
    expect(validateAndNormalizePostUrl('https://instagram.com/reels/XYZ', 'instagram')).toEqual({
      ok: true,
      normalized: 'https://instagram.com/reels/XYZ',
    });
    expect(validateAndNormalizePostUrl('https://instagram.com/tv/XYZ', 'instagram')).toEqual({
      ok: true,
      normalized: 'https://instagram.com/tv/XYZ',
    });
  });

  it('drops a username prefix', () => {
    expect(
      validateAndNormalizePostUrl('https://instagram.com/someuser/reel/XYZ/', 'instagram'),
    ).toEqual({ ok: true, normalized: 'https://instagram.com/reel/XYZ' });
  });

  it.each([
    'https://instagram.com/explore/',
    'https://instagram.com/p/',
    'https://instagram.com/stories/XYZ',
    'https://instagram.com/a/p/b/c',
    'https://www.instagram.com/p/ab!c',
  ])('rejects the malformed Instagram path %s', (url) => {
    expect(validateAndNormalizePostUrl(url, 'instagram').ok).toBe(false);
  });

  it('rejects a YouTube URL on the Instagram platform', () => {
    const result = validateAndNormalizePostUrl('https://youtu.be/dQw4w9WgXcQ', 'instagram');
    expect(result.ok).toBe(false);
  });
});

describe('validateAndNormalizePostUrl — YouTube', () => {
  const ID = 'dQw4w9WgXcQ';
  const CANONICAL = 'https://youtube.com/watch?v=dQw4w9WgXcQ';

  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}&t=30s`,
    `http://youtube.com/watch?v=${ID}`,
    `https://youtube.com/shorts/${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
  ])('normalizes the video link %s to one canonical URL', (url) => {
    expect(validateAndNormalizePostUrl(url, 'youtube')).toEqual({
      ok: true,
      normalized: CANONICAL,
    });
  });

  it.each([
    'https://youtube.com/watch',
    'https://youtube.com/watch?v=abc',
    'https://youtube.com/shorts',
    'https://youtu.be/',
    'https://youtube.com/embed/dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
  ])('rejects the malformed YouTube link %s', (url) => {
    expect(validateAndNormalizePostUrl(url, 'youtube').ok).toBe(false);
  });

  it('rejects an Instagram URL on the YouTube platform', () => {
    const result = validateAndNormalizePostUrl('https://instagram.com/p/ABC123', 'youtube');
    expect(result.ok).toBe(false);
  });
});

describe('validateAndNormalizePostUrl — general', () => {
  it.each(['', '   ', 'not a url', 'instagram.com/p/ABC123', 'https://'])(
    'rejects the malformed URL %p',
    (url) => {
      expect(validateAndNormalizePostUrl(url, 'instagram').ok).toBe(false);
    },
  );

  it.each(['ftp://instagram.com/p/ABC123', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'rejects the non-http(s) URL %s',
    (url) => {
      expect(validateAndNormalizePostUrl(url, 'instagram').ok).toBe(false);
    },
  );

  it('returns a human-readable reason on failure', () => {
    const result = validateAndNormalizePostUrl('https://vimeo.com/12345', 'youtube');
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(validateAndNormalizePostUrl('  https://instagram.com/p/ABC123  ', 'instagram')).toEqual({
      ok: true,
      normalized: 'https://instagram.com/p/ABC123',
    });
  });
});
