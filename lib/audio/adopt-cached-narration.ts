'use client';

/**
 * Convert a course's pre-allocation narration to stored assets, for free.
 *
 * A course narrated before this application stored media server-side holds a
 * derived key on every speech action — `tts_s<order>_<action>` — and the bytes
 * for it only in this browser's local audio table. The document outlives the
 * browser now, so those references are a promise the course cannot keep: the
 * author's next device, and every visitor, reads an id nothing can resolve.
 *
 * The bytes are already paid for, so the author's own browser converts them
 * rather than re-synthesizing: allocate the clip in the pool, write the
 * allocated id back into the speech action, and mirror the row locally under
 * its new id. No provider is called, and a course converges on the first load
 * by an owner who still has the cache.
 *
 * What this deliberately does NOT do:
 *
 * - It does not run for a visitor. Ownership is the same gate every other
 *   spending or writing path uses, and it fails closed: a browser that cannot
 *   prove it owns the course writes nothing to it.
 * - It does not run in browser-only mode, where a derived key is a complete
 *   address and the document and the audio share one lifetime.
 * - It does not synthesize anything. A speech action whose bytes are not in
 *   this browser is left exactly as it is, still carrying its derived id: that
 *   narration is simply lost, and paying a provider to replace it is a
 *   decision for the author to make, not a side effect of opening a course.
 *   Such an action is reported in the return value rather than logged away.
 */
import { putAsset } from '@/lib/media/asset-pool';
import { mayGenerateForStage } from '@/lib/classroom/generation-permission';
import { createLogger } from '@/lib/logger';
import { mayNameAPoolAsset } from '@/lib/media/media-placeholder';
import { isServerBackedMediaPersistence } from '@/lib/persistence/media-persistence';
import { db } from '@/lib/utils/database';

import { persistNarrationReference } from './persist-narration-reference';

const log = createLogger('NarrationAdoption');

export interface NarrationAdoptionOutcome {
  /** Speech actions whose bytes were stored and whose reference was rewritten. */
  readonly adopted: number;
  /** Derived references left alone because this browser has no bytes for them. */
  readonly unbacked: number;
}

/** Every derived narration reference the open course still carries. */
function derivedNarrationRefs(scenes: readonly { actions?: readonly unknown[] }[]): string[] {
  const refs = new Set<string>();
  for (const scene of scenes) {
    for (const action of scene.actions ?? []) {
      if (typeof action !== 'object' || action === null) continue;
      const candidate = action as { type?: unknown; audioId?: unknown };
      if (candidate.type !== 'speech') continue;
      const audioId = candidate.audioId;
      if (typeof audioId !== 'string' || audioId === '') continue;
      if (mayNameAPoolAsset(audioId)) continue;
      refs.add(audioId);
    }
  }
  return [...refs];
}

/**
 * Adopt this browser's cached narration for the open course.
 *
 * Safe to call on every load: a course whose narration is already allocated
 * finds nothing to do and touches neither the pool nor the document.
 */
export async function adoptCachedNarration(stageId: string): Promise<NarrationAdoptionOutcome> {
  const idle: NarrationAdoptionOutcome = { adopted: 0, unbacked: 0 };
  if (!isServerBackedMediaPersistence()) return idle;
  // Fail-closed: 'owner' is the only answer that may write.
  if (!mayGenerateForStage(stageId)) return idle;

  const { useStageStore } = await import('@/lib/store/stage');
  const state = useStageStore.getState();
  if (state.stage?.id !== stageId) return idle;

  const refs = derivedNarrationRefs(state.scenes);
  if (refs.length === 0) return idle;

  let adopted = 0;
  let unbacked = 0;
  for (const derivedRef of refs) {
    // The derived id IS the local key: that is what made it usable before
    // allocation existed.
    const row = await db.audioFiles.get(derivedRef).catch(() => undefined);
    if (!row?.blob || row.blob.size === 0) {
      unbacked += 1;
      continue;
    }

    let assetId: string;
    try {
      // Bytes first, exactly as the media path does it: a document may never
      // name narration that was not stored.
      assetId = await putAsset(row.blob, {
        contentType: row.blob.type || `audio/${row.format}`,
        ...(row.duration === undefined ? {} : { durationSeconds: row.duration }),
      });
    } catch (error) {
      // One clip's storage failure costs that clip. The action keeps its
      // derived id and is adopted on a later load.
      log.warn(`Could not store cached narration ${derivedRef}:`, error);
      unbacked += 1;
      continue;
    }

    const placed = await persistNarrationReference(stageId, derivedRef, assetId).catch(
      (error: unknown) => {
        log.warn(`Could not write back narration ${derivedRef}:`, error);
        return false;
      },
    );
    if (!placed) {
      unbacked += 1;
      continue;
    }

    // Local mirror under the new id, so this browser plays the clip without a
    // download. The document already points at the pool, so a failed cache
    // write costs a re-download and nothing else.
    await db.audioFiles
      .put({ ...row, id: assetId, stageId, originAudioId: derivedRef })
      .catch((error: unknown) => {
        log.warn(`Local narration cache mirror failed for ${assetId}:`, error);
      });
    adopted += 1;
  }

  if (adopted > 0) {
    log.info(`Adopted ${adopted} cached narration clip(s) for ${stageId}; no provider call.`);
  }
  return { adopted, unbacked };
}
