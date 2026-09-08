'use client';

/**
 * Write an allocated narration id back into the speech action that holds a
 * derived one.
 *
 * The sibling of the generated-media write-back funnel, for the other family
 * of references a course carries. It follows the same rules, for the same
 * reasons: the write goes through `mutateDocument`, so it re-reads the current
 * document under the per-stage document lock rather than overwriting whatever
 * a concurrent editor wrote; the live stage store takes the same rewrite; and
 * the rewritten scenes are marked dirty afterwards, so an autosave round that
 * captured its snapshot before the rewrite leaves a corrective flush queued
 * behind it instead of writing the derived id back over the allocated one.
 *
 * It is simpler than the media funnel in one way that matters: there is
 * nothing to park. A media placeholder can be committed before the slide that
 * carries it exists, so its allocation has to wait somewhere; a speech action
 * being converted is by definition already in the document being read.
 */
import { mutateDocument } from '@/lib/document-store';
import { markStagePersistenceDirty, useStageStore } from '@/lib/store/stage';
import type { Scene } from '@/lib/types/stage';
import type { PendingChange } from '@/lib/utils/stage-storage';

/**
 * Point every speech action holding `derivedRef` at `assetId`, in place.
 *
 * Returns whether anything changed. A derived id is shared by no two actions
 * in practice — it is built from the scene order and the action id — but the
 * rewrite is written as a sweep anyway, because a duplicated id must not leave
 * half the actions behind.
 */
export function rewriteSceneNarrationReference(
  scene: Scene,
  derivedRef: string,
  assetId: string,
): boolean {
  let changed = false;
  for (const action of scene.actions ?? []) {
    if (action.type !== 'speech' || action.audioId !== derivedRef) continue;
    action.audioId = assetId;
    // An invalidation flag belongs to the reference that was invalidated.
    // Carrying it onto freshly stored bytes would hide them from playback.
    if (action.audioInvalidated) delete action.audioInvalidated;
    changed = true;
  }
  return changed;
}

function applyToLiveStage(stageId: string, derivedRef: string, assetId: string): boolean {
  const state = useStageStore.getState();
  if (state.stage?.id !== stageId) return false;

  const dirty: PendingChange[] = [];
  const scenes = state.scenes.map((scene) => {
    const next = structuredClone(scene);
    if (!rewriteSceneNarrationReference(next, derivedRef, assetId)) return scene;
    dirty.push({ kind: 'scene', sceneId: next.id });
    return next;
  });

  if (dirty.length === 0) return false;
  // Order matters: the store must already hold the rewrite when the mark
  // schedules the next flush, so the snapshot that flush captures carries it.
  useStageStore.setState({ scenes });
  markStagePersistenceDirty(dirty);
  return true;
}

/**
 * Persist the rewrite, and report whether the reference is now — or is queued
 * to become — the allocated id.
 *
 * A document write that fails still leaves the live store rewritten: the bytes
 * are stored either way, and the next ordinary flush is what carries the id to
 * the server. Returning `false` means nothing anywhere took the rewrite, which
 * is the only case where the allocation bought nothing.
 */
export async function persistNarrationReference(
  stageId: string,
  derivedRef: string,
  assetId: string,
): Promise<boolean> {
  let documentMatched = false;
  try {
    await mutateDocument(stageId, async (document, store) => {
      if (!document) return;
      const now = Date.now();
      for (const scene of document.scenes) {
        if (!rewriteSceneNarrationReference(scene, derivedRef, assetId)) continue;
        await store.putScene(stageId, { ...scene, updatedAt: now });
        documentMatched = true;
      }
    });
  } catch (error) {
    const placedLive = applyToLiveStage(stageId, derivedRef, assetId);
    if (!placedLive) throw error;
    return true;
  }

  const placedLive = applyToLiveStage(stageId, derivedRef, assetId);
  return documentMatched || placedLive;
}
