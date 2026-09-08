/**
 * How many bytes one asset principal may hold.
 *
 * The asset store enforces this inside its write transaction, under a
 * per-principal advisory lock, so concurrent uploads cannot race past it. What
 * it needs from here is a number — and until real per-user principals land,
 * every caller of this deployment resolves to one shared principal, so the
 * number is a deployment-wide ceiling rather than a per-user one.
 *
 * A default is set deliberately rather than left off. Allocation is reachable
 * by any caller the deployment admits, and this application only began writing
 * to the registry recently, so an unbounded store is unbounded database growth
 * with no operator-visible brake. Ten gibibytes is generous for a course
 * library and small enough to notice.
 */
const DEFAULT_ASSET_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

export function resolveAssetQuotaBytes(): number | undefined {
  const raw = process.env.ASSET_QUOTA_BYTES?.trim();
  if (!raw) return DEFAULT_ASSET_QUOTA_BYTES;
  // An explicit `0` is the documented way to opt out entirely, for a deployment
  // that bounds its storage somewhere else.
  if (raw === '0') return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    console.warn(
      `ASSET_QUOTA_BYTES=${raw} is not an integer of at least 0 bytes; ` +
        `using ${DEFAULT_ASSET_QUOTA_BYTES}`,
    );
    return DEFAULT_ASSET_QUOTA_BYTES;
  }
  return parsed;
}
