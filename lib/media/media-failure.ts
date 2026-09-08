/**
 * What a failed media task means, and whether asking again could change it.
 *
 * A media task fails for two very different reasons, and the difference has to
 * be visible in one place rather than re-derived at every affordance. A
 * transient failure — a timed-out provider, a dropped connection — is worth a
 * Retry. A refusal is not: the provider declined the content, the setting is
 * off, or the asset store is full. Offering Retry for a refusal invites the
 * user to buy the same generation over and over, and each attempt costs the
 * deployment a provider call before failing in exactly the same way.
 *
 * Every permanent code is also written to the local media table, so it survives
 * a reload as a `failed` task and the next generation pass skips the element
 * instead of paying for it again.
 */

/** The store is full. Raised by the asset layer, not by a generation route. */
export const ASSET_QUOTA_EXCEEDED = 'ASSET_QUOTA_EXCEEDED';

/**
 * Codes a retry cannot change.
 *
 * `CONTENT_SENSITIVE` is the provider's own refusal, `GENERATION_DISABLED` is
 * the deployment's, and `ASSET_QUOTA_EXCEEDED` is the store's. Anything else,
 * including an absent code, stays retryable — an unknown failure is treated as
 * transient, because the cost of one extra attempt is much smaller than the
 * cost of a slide that can never be recovered.
 */
const PERMANENT_MEDIA_FAILURE_CODES: ReadonlySet<string> = new Set([
  'CONTENT_SENSITIVE',
  'GENERATION_DISABLED',
  ASSET_QUOTA_EXCEEDED,
]);

/** Whether a failed task may be tried again. */
export function isRetryableMediaFailure(task: { readonly errorCode?: string }): boolean {
  return task.errorCode === undefined || !PERMANENT_MEDIA_FAILURE_CODES.has(task.errorCode);
}

/**
 * The message to show instead of a Retry button, for a refusal that has one.
 *
 * `GENERATION_DISABLED` is absent on purpose: a disabled generation setting has
 * its own state in the renderer, painted before any failure is considered.
 */
export function mediaFailureNoticeKey(errorCode: string | undefined): string | undefined {
  if (errorCode === 'CONTENT_SENSITIVE') return 'settings.mediaContentSensitive';
  if (errorCode === ASSET_QUOTA_EXCEEDED) return 'settings.mediaStorageFull';
  return undefined;
}
