/**
 * Pre-allocation narration converges on the owner's next load, for free.
 *
 * A course narrated before this application stored media server-side holds a
 * derived key on every speech action, and the bytes for it only in the
 * author's own browser. The document outlives that browser now, so every other
 * reader — the author's next device, every visitor — sees a reference nothing
 * can resolve. The bytes are already paid for, so the owner's browser stores
 * them and rewrites the reference; nothing here calls a provider.
 *
 * The REAL stage store and the REAL write-back funnel are loaded, because the
 * question is not only "was an asset allocated" but "does the document, and
 * the store the next save will flush, end up pointing at it".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutateDocument: vi.fn(),
  saveStageDataIncremental: vi.fn(),
  saveStageData: vi.fn(),
  putAsset: vi.fn(),
  audioGet: vi.fn(),
  audioPut: vi.fn(),
  serverBacked: vi.fn(),
}));

vi.mock('@/lib/document-store', () => ({ mutateDocument: mocks.mutateDocument }));
vi.mock('@/lib/utils/stage-storage', () => ({
  saveStageDataIncremental: mocks.saveStageDataIncremental,
  saveStageData: mocks.saveStageData,
}));
vi.mock('@/lib/media/asset-pool', () => ({ putAsset: mocks.putAsset }));
vi.mock('@/lib/utils/database', () => ({
  db: { audioFiles: { get: mocks.audioGet, put: mocks.audioPut } },
}));
vi.mock('@/lib/persistence/media-persistence', () => ({
  isServerBackedMediaPersistence: mocks.serverBacked,
}));

import { adoptCachedNarration } from '@/lib/audio/adopt-cached-narration';
import {
  noteStageGenerationOwnership,
  resetGenerationPermissionsForTests,
} from '@/lib/classroom/generation-permission';
import { useStageStore } from '@/lib/store/stage';
import type { Scene } from '@/lib/types/stage';

const stageId = 'narration-stage';
const derivedRef = 'tts_s1_speech-1';

function sceneWithSpeech(audioId: string | undefined): Scene {
  return {
    id: 'scene-1',
    stageId,
    title: 'Scene',
    order: 1,
    type: 'slide',
    content: { type: 'slide', canvas: { id: 'slide-1', elements: [] } },
    actions: [
      { id: 'speech-1', type: 'speech', text: 'Welcome', ...(audioId ? { audioId } : {}) },
      { id: 'pause-1', type: 'pause', duration: 1 },
    ],
  } as unknown as Scene;
}

function audioIdOf(scene: Scene): string | undefined {
  const actions = (scene as unknown as { actions: Array<{ audioId?: string }> }).actions;
  return actions[0]?.audioId;
}

function cachedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: derivedRef,
    stageId,
    blob: new Blob(['narration-bytes'], { type: 'audio/mp3' }),
    duration: 2.5,
    format: 'mp3',
    text: 'Welcome',
    createdAt: 0,
    ...overrides,
  };
}

describe('adopting cached narration', () => {
  beforeEach(() => {
    resetGenerationPermissionsForTests();
    mocks.mutateDocument.mockReset();
    mocks.saveStageData.mockReset().mockResolvedValue(undefined);
    mocks.saveStageDataIncremental.mockReset().mockResolvedValue(undefined);
    mocks.putAsset.mockReset().mockResolvedValue('ast_narration');
    mocks.audioGet.mockReset().mockResolvedValue(undefined);
    mocks.audioPut.mockReset().mockResolvedValue(undefined);
    mocks.serverBacked.mockReset().mockReturnValue(true);
    noteStageGenerationOwnership(stageId, 'owner');
    useStageStore.setState({
      stage: { id: stageId, name: 'Course' } as never,
      scenes: [sceneWithSpeech(derivedRef)],
    });
  });

  afterEach(() => {
    useStageStore.setState({ stage: null, scenes: [] });
    resetGenerationPermissionsForTests();
  });

  /** Run the funnel against a document that holds the same derived reference. */
  function serveDocument(): { putScene: ReturnType<typeof vi.fn>; scenes: Scene[] } {
    const scenes = [sceneWithSpeech(derivedRef)];
    const putScene = vi.fn().mockResolvedValue(undefined);
    mocks.mutateDocument.mockImplementation(
      async (_stageId: string, work: (document: unknown, store: unknown) => Promise<void>) => {
        await work({ scenes, stage: { id: stageId } }, { putScene, putStage: vi.fn() });
      },
    );
    return { putScene, scenes };
  }

  it('stores the cached clip and rewrites the reference, without a provider call', async () => {
    const { putScene, scenes } = serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow());

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 1, unbacked: 0 });

    // Bytes first: a document may never name narration that was not stored.
    const [stored, meta] = mocks.putAsset.mock.calls[0] as [Blob, Record<string, unknown>];
    await expect(stored.text()).resolves.toBe('narration-bytes');
    expect(meta).toEqual({ contentType: 'audio/mp3', durationSeconds: 2.5 });

    // The derived id IS the local key: that is what made it usable before
    // allocation existed.
    expect(mocks.audioGet).toHaveBeenCalledWith(derivedRef);
    expect(putScene).toHaveBeenCalledTimes(1);
    expect(audioIdOf(scenes[0])).toBe('ast_narration');
    // And the live store, whose snapshot the next save flushes.
    expect(audioIdOf(useStageStore.getState().scenes[0])).toBe('ast_narration');
    // Mirrored locally under the new id so this browser needs no download.
    expect(mocks.audioPut).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ast_narration', originAudioId: derivedRef, stageId }),
    );
  });

  // The derived key contains no stage id and `audioFiles` is keyed by id alone,
  // so two courses can mint the same key -- a PPTX import numbers its scenes
  // and actions deterministically, which gives every imported deck's first
  // slide `tts_s1_speech-scene-p1`. Locally that means one course plays
  // another's clip in one browser. Adopting it would write that clip into the
  // shared document permanently, for every device and every visitor.
  it('refuses a row that belongs to another course', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow({ stageId: 'another-course' }));

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 1 });

    expect(mocks.putAsset).not.toHaveBeenCalled();
    expect(mocks.mutateDocument).not.toHaveBeenCalled();
    expect(audioIdOf(useStageStore.getState().scenes[0])).toBe(derivedRef);
  });

  // Rows written before the stage column existed are the population this
  // feature exists for, so they cannot simply be refused. They are admitted on
  // the other evidence the row carries.
  it('adopts a legacy row with no stage whose text matches the action', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow({ stageId: undefined, text: 'Welcome' }));

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 1, unbacked: 0 });

    expect(audioIdOf(useStageStore.getState().scenes[0])).toBe('ast_narration');
  });

  it.each([
    ['whose text is another line', { stageId: undefined, text: 'A different line entirely' }],
    ['that records no text at all', { stageId: undefined, text: undefined }],
    ['whose text is blank', { stageId: undefined, text: '   ' }],
  ])('refuses a legacy row %s', async (_name, overrides) => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow(overrides));

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 1 });

    expect(mocks.putAsset).not.toHaveBeenCalled();
    expect(audioIdOf(useStageStore.getState().scenes[0])).toBe(derivedRef);
  });

  it('leaves a concrete address alone rather than treating it as a local key', async () => {
    serveDocument();
    useStageStore.setState({ scenes: [sceneWithSpeech('/classroom-media/course/clip.mp3')] });

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 0 });

    expect(mocks.audioGet).not.toHaveBeenCalled();
  });

  // Allocation is uncancellable and its write-back cannot be half-undone, so
  // the loop stops between clips: a course left mid-adoption must not have the
  // rest of its deck allocated against it, or its document lock taken for them.
  it('stops between clips when the course is left', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow());
    const controller = new AbortController();
    controller.abort();

    await expect(adoptCachedNarration(stageId, controller.signal)).resolves.toEqual({
      adopted: 0,
      unbacked: 0,
    });

    expect(mocks.putAsset).not.toHaveBeenCalled();
  });

  it('does not write back a clip whose course was switched during the upload', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow());
    mocks.putAsset.mockImplementation(async () => {
      // The author moved on while the bytes were in flight.
      useStageStore.setState({ stage: { id: 'another-course' } as never });
      return 'ast_narration';
    });

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 1 });

    expect(mocks.mutateDocument).not.toHaveBeenCalled();
  });

  it('leaves a line whose bytes this browser does not have', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(undefined);

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 1 });

    expect(mocks.putAsset).not.toHaveBeenCalled();
    expect(audioIdOf(useStageStore.getState().scenes[0])).toBe(derivedRef);
  });

  it('does nothing for a viewer who is not the owner', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow());
    noteStageGenerationOwnership(stageId, 'not-owner');

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 0 });

    expect(mocks.putAsset).not.toHaveBeenCalled();
    expect(mocks.mutateDocument).not.toHaveBeenCalled();
  });

  it('does nothing while ownership is still unresolved', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow());
    noteStageGenerationOwnership(stageId, 'unresolved');

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 0 });

    expect(mocks.putAsset).not.toHaveBeenCalled();
  });

  it('does nothing in browser-only mode, where the derived id is a complete address', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow());
    mocks.serverBacked.mockReturnValue(false);

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 0 });

    expect(mocks.putAsset).not.toHaveBeenCalled();
  });

  it('reads nothing for a course whose narration is already allocated', async () => {
    serveDocument();
    useStageStore.setState({ scenes: [sceneWithSpeech('ast_already')] });

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 0 });

    expect(mocks.audioGet).not.toHaveBeenCalled();
    expect(mocks.putAsset).not.toHaveBeenCalled();
  });

  it('refuses to write into a course this browser no longer has open', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow());
    useStageStore.setState({ stage: { id: 'another-course' } as never });

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 0 });

    expect(mocks.putAsset).not.toHaveBeenCalled();
  });

  it('counts a clip whose storage fails as unbacked, and keeps its derived id', async () => {
    serveDocument();
    mocks.audioGet.mockResolvedValue(cachedRow());
    mocks.putAsset.mockRejectedValue(new Error('the store is full'));

    await expect(adoptCachedNarration(stageId)).resolves.toEqual({ adopted: 0, unbacked: 1 });

    expect(audioIdOf(useStageStore.getState().scenes[0])).toBe(derivedRef);
  });
});
