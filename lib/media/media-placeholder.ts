/**
 * References that cannot possibly name a pool asset.
 *
 * Pool ids are allocated by `put` and nothing else, so a reference carrying a
 * shape this application mints itself — a generation placeholder, or a derived
 * narration key from before allocation existed — was never in the pool and
 * never will be. Asking anyway is not free once the pool is server-backed: each
 * lease becomes a real `GET /assets/<ref>/content` that answers 404, one per
 * element per load, forever on a course that still holds placeholders.
 *
 * This is a cheap negative test, not an id validator. The pool's id domain is
 * deliberately unconstrained (see `@openmaic/storage`'s `toAssetId`), so nothing
 * here decides what a *valid* id looks like — only that these particular shapes
 * are ours, and are not it.
 *
 * Applied unconditionally, in both persistence modes. In browser-only mode the
 * lookup was answered locally by an IndexedDB miss rather than a round trip, so
 * skipping it returns the same `null` at less cost; the pool cannot hold one of
 * these refs in either mode, because it never issued one.
 */
import { isGeneratedMediaPlaceholder } from './media-ref';

/**
 * The narration key shape used before narration had allocated identities:
 * `tts_s<sceneOrder>_<actionId>`, and the request-scoped `tts_request_s…`
 * variant. Bytes for these live in the local audio table, never in the pool.
 */
const LEGACY_SPEECH_AUDIO_ID = /^tts_(?:request_)?s-?\d+_/;

export function isNonPoolMediaReference(ref: string | undefined): boolean {
  if (!ref) return true;
  return isGeneratedMediaPlaceholder(ref) || LEGACY_SPEECH_AUDIO_ID.test(ref);
}

/** The inverse, for the many call sites that read better in the positive. */
export function mayNameAPoolAsset(ref: string | undefined): ref is string {
  return !isNonPoolMediaReference(ref);
}
