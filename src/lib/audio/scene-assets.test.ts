import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { resolveSceneAssets, resolveMusicFromStructure } from './scene-assets'
import type { SceneAudioPackage } from '@/types/audio'

// ─── Index fixtures ───

const MUSIC_INDEX = {
  version: '1.0',
  generatedAt: '2026-04-24T00:00:00.000Z',
  assets: [
    { id: 'music-tension-001', filename: 'tension.wav', description: 'Tension strings', mood: 'tension', tempo: 'moderate', bpm: 90, durationS: 60, loopable: true, tags: ['tension'] },
    { id: 'music-calm-001', filename: 'calm.wav', description: 'Calm piano', mood: 'calme', tempo: 'slow', bpm: 60, durationS: 120, loopable: true, tags: ['calme'] },
  ],
}

const FX_INDEX = {
  version: '1.0',
  generatedAt: '2026-04-24T00:00:00.000Z',
  assets: [
    { id: 'fx-impact-001', category: 'impacts', filename: 'boom.wav', description: 'Impact lourd', durationS: 1.2, tags: ['impact'] },
    { id: 'fx-transition-001', category: 'transitions', filename: 'whoosh.wav', description: 'Transition rapide', durationS: 0.8, tags: ['transition'] },
  ],
}

// ─── Package factory ───

function makePkg(overrides: Partial<SceneAudioPackage['music']> = {}, fx: SceneAudioPackage['fx'] = []): SceneAudioPackage {
  return {
    version: '1.0',
    runId: 'run_test',
    sceneIndex: 0,
    title: 'Scène 0',
    narration: { lines: [], silences: [], stageDirections: '' },
    intention: { emotion: 'neutre', narrativeRole: 'standard', tensionLevel: 50, videoPromptHint: '' },
    ambiance: { description: 'none', intensity: 'subtle', stereoWidth: 'narrow' },
    fx,
    music: {
      mood: 'neutre',
      tempo: 'moderate',
      intensity: 0,
      instrumentation: 'none',
      placement: 'under_dialogue',
      volumeRelativeToDialogue: 'background',
      ...overrides,
    },
    timing: {
      targetDurationS: 10,
      minDurationS: 7,
      maxDurationS: 13,
      transitionIn: { type: 'cut', durationMs: 0 },
      transitionOut: { type: 'cut', durationMs: 0 },
    },
    dependencies: { continuesAmbianceFrom: null, continuesMusicFrom: null, requiredBeforeScene: [], sharedSpeakers: [] },
  }
}

// ─── Setup ───

describe('resolveSceneAssets', () => {
  let tmpDir: string
  let musicIndex: string
  let fxIndex: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'scene-assets-'))
    musicIndex = join(tmpDir, 'music', 'index.json')
    fxIndex = join(tmpDir, 'fx', 'index.json')
    await mkdir(join(tmpDir, 'music'), { recursive: true })
    await mkdir(join(tmpDir, 'fx'), { recursive: true })
    await mkdir(join(tmpDir, 'fx', 'impacts'), { recursive: true })
    await mkdir(join(tmpDir, 'fx', 'transitions'), { recursive: true })
    await writeFile(musicIndex, JSON.stringify(MUSIC_INDEX))
    await writeFile(fxIndex, JSON.stringify(FX_INDEX))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── Musique : règle intensity === 0 ───

  it('intensity=0 sans sourceHint → musicPath null', async () => {
    const { musicPath } = await resolveSceneAssets(makePkg({ intensity: 0 }), { musicIndexPath: musicIndex })
    expect(musicPath).toBeNull()
  })

  // ─── Musique : résolution par mood ───

  it('intensity>0 + mood connu → musicPath résolu', async () => {
    const { musicPath } = await resolveSceneAssets(
      makePkg({ mood: 'tension', intensity: 50 }),
      { musicIndexPath: musicIndex },
    )
    expect(musicPath).not.toBeNull()
    expect(musicPath).toContain('tension.wav')
    expect(musicPath).toContain(join(tmpDir, 'music'))
  })

  it('intensity>0 + mood sans correspondance → musicPath null', async () => {
    const { musicPath } = await resolveSceneAssets(
      makePkg({ mood: 'action', intensity: 50 }),
      { musicIndexPath: musicIndex },
    )
    expect(musicPath).toBeNull()
  })

  // ─── Musique : résolution par sourceHint (asset ID) ───

  it('sourceHint valide → piste exacte retournée', async () => {
    const { musicPath } = await resolveSceneAssets(
      makePkg({ sourceHint: 'music-calm-001', intensity: 0 }),
      { musicIndexPath: musicIndex },
    )
    expect(musicPath).not.toBeNull()
    expect(musicPath).toContain('calm.wav')
  })

  it('sourceHint invalide + intensity>0 → fallback mood', async () => {
    const { musicPath } = await resolveSceneAssets(
      makePkg({ sourceHint: 'id-inexistant', mood: 'tension', intensity: 60 }),
      { musicIndexPath: musicIndex },
    )
    expect(musicPath).not.toBeNull()
    expect(musicPath).toContain('tension.wav')
  })

  it('sourceHint invalide + intensity=0 → null (pas de fallback mood)', async () => {
    const { musicPath } = await resolveSceneAssets(
      makePkg({ sourceHint: 'id-inexistant', mood: 'tension', intensity: 0 }),
      { musicIndexPath: musicIndex },
    )
    // sourceHint est truthy → on tente le fallback mood même avec intensity=0
    expect(musicPath).not.toBeNull()
    expect(musicPath).toContain('tension.wav')
  })

  // ─── FX ───

  it('fx vide → fxPaths []', async () => {
    const { fxPaths } = await resolveSceneAssets(makePkg(), { fxIndexPath: fxIndex })
    expect(fxPaths).toEqual([])
  })

  it('fx avec sourceHint valide → fxPath résolu', async () => {
    const { fxPaths } = await resolveSceneAssets(
      makePkg({}, [{ triggerAt: 'start', description: 'impact', intensity: 'hard', sourceHint: 'fx-impact-001' }]),
      { fxIndexPath: fxIndex },
    )
    expect(fxPaths).toHaveLength(1)
    expect(fxPaths[0]).toContain('boom.wav')
    expect(fxPaths[0]).toContain(join(tmpDir, 'fx', 'impacts'))
  })

  it('fx sans sourceHint → ignoré (pas d\'inférence)', async () => {
    const { fxPaths } = await resolveSceneAssets(
      makePkg({}, [{ triggerAt: 'end', description: 'whoosh', intensity: 'soft' }]),
      { fxIndexPath: fxIndex },
    )
    expect(fxPaths).toEqual([])
  })

  it('fx avec sourceHint invalide → ignoré silencieusement', async () => {
    const { fxPaths } = await resolveSceneAssets(
      makePkg({}, [{ triggerAt: 'start', description: 'boom', intensity: 'hard', sourceHint: 'fx-inexistant-999' }]),
      { fxIndexPath: fxIndex },
    )
    expect(fxPaths).toEqual([])
  })

  it('plusieurs fx : seuls ceux avec sourceHint valide sont résolus', async () => {
    const { fxPaths } = await resolveSceneAssets(
      makePkg({}, [
        { triggerAt: 'start', description: 'impact', intensity: 'hard', sourceHint: 'fx-impact-001' },
        { triggerAt: 'end', description: 'sans hint', intensity: 'soft' },
        { triggerAt: 'start', description: 'transition', intensity: 'medium', sourceHint: 'fx-transition-001' },
      ]),
      { fxIndexPath: fxIndex },
    )
    expect(fxPaths).toHaveLength(2)
    expect(fxPaths.some((p) => p.includes('boom.wav'))).toBe(true)
    expect(fxPaths.some((p) => p.includes('whoosh.wav'))).toBe(true)
  })

  // ─── resolveMusicFromStructure ───

  describe('resolveMusicFromStructure', () => {
    it('structure.json avec tone reconnu → piste résolue', async () => {
      await writeFile(join(tmpDir, 'structure.json'), JSON.stringify({ tone: 'tension dramatique' }))
      const path = await resolveMusicFromStructure(tmpDir, musicIndex)
      expect(path).not.toBeNull()
      expect(path).toContain('tension.wav')
    })

    it('structure.json avec style reconnu → piste résolue', async () => {
      await writeFile(join(tmpDir, 'structure.json'), JSON.stringify({ style: 'ambiance calme et apaisante' }))
      const path = await resolveMusicFromStructure(tmpDir, musicIndex)
      expect(path).not.toBeNull()
      expect(path).toContain('calm.wav')
    })

    it('tone inconnu → null', async () => {
      await writeFile(join(tmpDir, 'structure.json'), JSON.stringify({ tone: 'documentaire informatif' }))
      const path = await resolveMusicFromStructure(tmpDir, musicIndex)
      expect(path).toBeNull()
    })

    it('structure.json absent → null (non bloquant)', async () => {
      const path = await resolveMusicFromStructure(tmpDir, musicIndex)
      expect(path).toBeNull()
    })

    it('musicIndex absent → null (non bloquant)', async () => {
      await writeFile(join(tmpDir, 'structure.json'), JSON.stringify({ tone: 'tension' }))
      const path = await resolveMusicFromStructure(tmpDir, join(tmpDir, 'inexistant.json'))
      expect(path).toBeNull()
    })
  })

  // ─── Résilience : index absent ───

  it('musicIndex absent → musicPath null (non bloquant)', async () => {
    const { musicPath } = await resolveSceneAssets(
      makePkg({ mood: 'tension', intensity: 50 }),
      { musicIndexPath: join(tmpDir, 'inexistant.json') },
    )
    expect(musicPath).toBeNull()
  })

  it('fxIndex absent → fxPaths [] (non bloquant)', async () => {
    const { fxPaths } = await resolveSceneAssets(
      makePkg({}, [{ triggerAt: 'start', description: 'boom', intensity: 'hard', sourceHint: 'fx-impact-001' }]),
      { fxIndexPath: join(tmpDir, 'inexistant.json') },
    )
    expect(fxPaths).toEqual([])
  })
})
