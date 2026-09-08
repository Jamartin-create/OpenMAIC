/**
 * Allocation is reachable by any caller the deployment admits, and until
 * per-user asset principals land every one of them shares a single principal.
 * The store's quota is therefore the only thing bounding how much a deployment
 * can be made to hold.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveAssetQuotaBytes } from '@/lib/persistence/asset-quota';

const DEFAULT = 10 * 1024 * 1024 * 1024;

describe('asset quota configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('bounds a deployment that configured nothing', () => {
    vi.stubEnv('ASSET_QUOTA_BYTES', '');
    expect(resolveAssetQuotaBytes()).toBe(DEFAULT);
  });

  it('takes an operator’s own ceiling', () => {
    vi.stubEnv('ASSET_QUOTA_BYTES', '1048576');
    expect(resolveAssetQuotaBytes()).toBe(1_048_576);
  });

  it('lets a deployment opt out explicitly', () => {
    vi.stubEnv('ASSET_QUOTA_BYTES', '0');
    expect(resolveAssetQuotaBytes()).toBeUndefined();
  });

  it.each(['-1', 'lots', '1.5', '1e999'])(
    'falls back to the default rather than trusting %s',
    (raw) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubEnv('ASSET_QUOTA_BYTES', raw);
      expect(resolveAssetQuotaBytes()).toBe(DEFAULT);
      expect(warn).toHaveBeenCalledOnce();
    },
  );
});
