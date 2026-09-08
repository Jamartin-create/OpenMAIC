/**
 * A reference this application minted itself was never in the pool.
 *
 * The pool allocates every id it holds, so a `gen_img_*` placeholder or a
 * derived narration key cannot be one — and once the pool is server-backed,
 * asking anyway is a real `GET /assets/<ref>/content` that answers 404. During
 * generation that is one wasted request per element; on a course that still
 * holds placeholders it repeats per element per load, forever.
 *
 * The predicate is unit-tested here, and every lease and probe entry point is
 * checked for the guard, because a site that forgets it costs a request per
 * load and nothing else fails.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isNonPoolMediaReference, mayNameAPoolAsset } from '@/lib/media/media-placeholder';

describe('references the pool cannot hold', () => {
  it.each([
    'gen_img_1',
    'gen_img_CiZDrJ-a',
    'gen_vid_abc123',
    'GEN_IMG_UPPER',
    'tts_s2_speech-1',
    'tts_s-1_speech-1',
    'tts_request_s2_speech-1',
  ])('recognises %s as one this application minted', (ref) => {
    expect(isNonPoolMediaReference(ref)).toBe(true);
    expect(mayNameAPoolAsset(ref)).toBe(false);
  });

  it.each([
    'ast_t1h2w7xf9d',
    'ast_opaque_1',
    // Opaque by design: the id domain is unconstrained, so anything that is not
    // a shape this application mints must still be asked about.
    'generated-image-7',
    'ttsentity',
    'tts_speech-1',
    'https://cdn.example.com/image.png',
  ])('leaves %s to the pool to answer', (ref) => {
    expect(isNonPoolMediaReference(ref)).toBe(false);
    expect(mayNameAPoolAsset(ref)).toBe(true);
  });

  it('treats an absent reference as nothing to ask about', () => {
    expect(isNonPoolMediaReference(undefined)).toBe(true);
    expect(isNonPoolMediaReference('')).toBe(true);
  });
});

// No component-render harness exists, so the wiring is checked statically: a
// site that drops the guard still passes every behavioural test while making a
// request per element per load.
describe('every lease and probe entry point carries the guard', () => {
  it.each([
    'lib/media/resolve-media-ref.ts',
    'components/slide-renderer/use-resolved-slide.ts',
    'lib/utils/stage-storage.ts',
    'lib/media/resolve-audio-bytes.ts',
    'lib/media/resolve-stored-bytes.ts',
    'lib/audio/regenerate-speech-tts.ts',
  ])('%s guards before it asks the pool', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    expect(source).toContain('mayNameAPoolAsset');
  });

  it('names every module that reaches the pool, so a new one cannot be missed', () => {
    // The lease and probe helpers all live in one module; anything that calls
    // them, or the pool directly, needs the guard. If this list grows, the
    // per-site check above must grow with it.
    const roots = ['lib', 'components', 'app'];
    const hits = execSync(
      `grep -rl "useAssetUrlLease\\|useAssetUrlLeases\\|withAssetUrl\\|assetRefExists" ${roots.join(' ')} || true`,
      { cwd: process.cwd(), encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line && !line.includes('/dist/') && !line.endsWith('use-asset-url.ts'))
      .sort();

    expect(hits).toEqual([
      'components/slide-renderer/use-resolved-slide.ts',
      'lib/audio/regenerate-speech-tts.ts',
      'lib/media/resolve-audio-bytes.ts',
      'lib/media/resolve-media-ref.ts',
      'lib/media/resolve-stored-bytes.ts',
      'lib/utils/stage-storage.ts',
    ]);
  });
});
