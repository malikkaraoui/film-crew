import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'

vi.mock('@/lib/pipeline/tts-renderer')
vi.mock('@/lib/audio/tts-render')
vi.mock('@/lib/audio/mix-scene')
vi.mock('@/lib/audio/mix-master')
vi.mock('@/lib/audio/fx-library')
vi.mock('@/lib/audio/scene-assets')
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}))

import { readFile, rm, copyFile } from 'fs/promises'
import { renderDialogueToTTS } from '@/lib/pipeline/tts-renderer'
import { assembleSceneTTS } from '@/lib/audio/tts-render'
import { mixScene } from '@/lib/audio/mix-scene'
import { assembleMaster } from '@/lib/audio/mix-master'
import { loadFXIndex } from '@/lib/audio/fx-library'
import { resolveMusicFromStructure } from '@/lib/audio/scene-assets'
import { parseSceneAudioPackage } from '@/lib/audio/scene-canon'

import {
  dialogueSceneToPackage,
  cleanupStaleAudioArtifacts,
  step4cAudio,
} from './step-4c-audio'
import type { DialogueScript, DialogueScene } from '@/types/audio'
import type { TTSManifest } from '@/lib/pipeline/tts-renderer'
import type { StepContext } from '../types'

// ─── Helpers ───

function makeCtx(storagePath = '/tmp/run_test'): StepContext {
  return { runId: 'run_test', chainId: null, idea: 'test', brandKitPath: null, storagePath, intentionPath: null, template: null }
}

// ─── Sample data ───

const sampleScript: DialogueScript = {
  runId: 'run_test',
  language: 'fr',
  totalDurationTargetS: 20,
  scenes: [
    {
      sceneIndex: 0,
      title: 'Scène 0',
      durationTargetS: 10,
      stageDirections: '',
      lines: [{ lineIndex: 0, speaker: 'narrateur', text: 'Bonjour.', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 1.5 }],
      silences: [],
    },
    {
      sceneIndex: 1,
      title: 'Scène 1',
      durationTargetS: 10,
      stageDirections: '',
      lines: [{ lineIndex: 0, speaker: 'narrateur', text: 'Fin.', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 1.0 }],
      silences: [],
    },
  ],
}

const sampleManifest: TTSManifest = {
  runId: 'run_test',
  provider: 'kokoro-local',
  voice: 'default',
  language: 'fr',
  lines: [
    { sceneIndex: 0, lineIndex: 0, speaker: 'narrateur', filePath: 'tts-scene0-line0.wav', durationS: 1.5 },
    { sceneIndex: 1, lineIndex: 0, speaker: 'narrateur', filePath: 'tts-scene1-line0.wav', durationS: 1.0 },
  ],
}

// ─── Typed mocks ───

const mockReadFile = readFile as MockedFunction<typeof readFile>
const mockRm = rm as MockedFunction<typeof rm>
const mockCopyFile = copyFile as MockedFunction<typeof copyFile>
const mockRenderDialogueToTTS = renderDialogueToTTS as MockedFunction<typeof renderDialogueToTTS>
const mockAssembleSceneTTS = assembleSceneTTS as MockedFunction<typeof assembleSceneTTS>
const mockMixScene = mixScene as MockedFunction<typeof mixScene>
const mockAssembleMaster = assembleMaster as MockedFunction<typeof assembleMaster>
const mockLoadFXIndex = loadFXIndex as MockedFunction<typeof loadFXIndex>
const mockResolveMusicFromStructure = resolveMusicFromStructure as MockedFunction<typeof resolveMusicFromStructure>

// ─── FX fixtures ───

const fxTransition = {
  id: 'transition-001', category: 'transitions' as const, filename: 'swoosh-001.wav',
  filePath: '/assets/fx/transitions/swoosh-001.wav', description: 'Swoosh', durationS: 0.4, tags: ['swoosh'],
}
const fxImpact = {
  id: 'impact-001', category: 'impacts' as const, filename: 'impact-drum-001.wav',
  filePath: '/assets/fx/impacts/impact-drum-001.wav', description: 'Impact', durationS: 0.6, tags: ['impact'],
}

// ─── Default mock implementations ───

function setupHappyPath() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockReadFile.mockResolvedValue(JSON.stringify(sampleScript) as any)
  mockRenderDialogueToTTS.mockResolvedValue(sampleManifest)
  mockLoadFXIndex.mockResolvedValue([fxTransition, fxImpact])
  mockResolveMusicFromStructure.mockResolvedValue(null)
  mockAssembleSceneTTS.mockImplementation(async ({ scene }) => ({
    sceneIndex: scene.sceneIndex,
    concatFilePath: `/tmp/run_test/audio/scenes/${scene.sceneIndex}/tts-scene${scene.sceneIndex}.wav`,
    totalDurationS: 1.5,
    lineCount: 1,
    silenceCount: 0,
    provider: 'kokoro-local',
    costEur: 0,
  }))
  mockMixScene.mockResolvedValue(undefined)
  mockAssembleMaster.mockResolvedValue({
    version: '1.0',
    runId: 'run_test',
    totalDurationS: 3.0,
    sampleRate: 44100,
    channels: 2,
    masterFilePath: '/tmp/run_test/audio/master.wav',
    scenes: [],
    qualityChecks: { allScenesRendered: true, totalCostEur: 0 },
    generatedAt: new Date().toISOString(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Tests ───

describe('dialogueSceneToPackage', () => {
  it('produit un package valide selon parseSceneAudioPackage', () => {
    const scene: DialogueScene = sampleScript.scenes[0]
    const pkg = dialogueSceneToPackage(scene, 'run_test')
    const result = parseSceneAudioPackage(pkg)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sceneIndex).toBe(0)
      expect(result.data.runId).toBe('run_test')
      expect(result.data.version).toBe('1.0')
    }
  })
})

describe('step4cAudio', () => {
  it('skip si dialogue_script.json absent (ENOENT)', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    mockReadFile.mockRejectedValue(err)
    const result = await step4cAudio.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).skipped).toBe(true)
    expect((result.outputData as Record<string, unknown>).reason).toContain('absent')
  })

  it('ttsUnavailable si renderDialogueToTTS retourne null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockReadFile.mockResolvedValue(JSON.stringify(sampleScript) as any)
    mockRenderDialogueToTTS.mockResolvedValue(null)
    const result = await step4cAudio.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).ttsUnavailable).toBe(true)
  })

  it('chemin nominal : 2 scènes → assembleMaster appelé, success=true, sceneCount=2', async () => {
    setupHappyPath()
    const result = await step4cAudio.execute(makeCtx())
    expect(result.success).toBe(true)
    expect(mockAssembleMaster).toHaveBeenCalledOnce()
    const data = result.outputData as Record<string, unknown>
    expect(data.sceneCount).toBe(2)
  })

  it('assemblyFailed si assembleMaster throw', async () => {
    setupHappyPath()
    mockAssembleMaster.mockRejectedValue(new Error('concat failed'))
    const result = await step4cAudio.execute(makeCtx())
    expect(result.success).toBe(true)
    const data = result.outputData as Record<string, unknown>
    expect(data.assemblyFailed).toBe(true)
    expect(data.reason).toContain('concat failed')
  })

  it("fallback mix : mixScene throw -> copyFile appele, pipeline continue jusqu'a assembleMaster", async () => {
    setupHappyPath()
    mockMixScene.mockRejectedValue(new Error('ffmpeg not found'))
    const result = await step4cAudio.execute(makeCtx())
    expect(mockCopyFile).toHaveBeenCalled()
    expect(mockAssembleMaster).toHaveBeenCalledOnce()
    expect(result.success).toBe(true)
  })
})

describe('cleanupStaleAudioArtifacts', () => {
  it('appelle rm pour les 3 chemins attendus', async () => {
    await cleanupStaleAudioArtifacts('/tmp/run_test')
    const rmCalls = mockRm.mock.calls.map((call) => call[0])
    expect(rmCalls).toContain('/tmp/run_test/audio/audio-master-manifest.json')
    expect(rmCalls).toContain('/tmp/run_test/audio/master.wav')
    expect(rmCalls).toContain('/tmp/run_test/audio/scenes')
  })
})

describe('step4cAudio — FX', () => {
  it('loadFXIndex appelé exactement une fois (pas dans la boucle)', async () => {
    setupHappyPath()
    await step4cAudio.execute(makeCtx())
    expect(mockLoadFXIndex).toHaveBeenCalledOnce()
  })

  it('fxCount dans outputData = nombre de FX effectivement passés à mixScene', async () => {
    setupHappyPath() // 2 scènes : première reçoit transition, dernière reçoit impact
    const result = await step4cAudio.execute(makeCtx())
    const data = result.outputData as Record<string, unknown>
    expect(data.fxCount).toBe(2)
  })

  it('première scène → mixScene appelé avec fxPaths non vide', async () => {
    setupHappyPath()
    await step4cAudio.execute(makeCtx())
    const firstCall = mockMixScene.mock.calls[0][0]
    expect(firstCall.fxPaths).toHaveLength(1)
    expect(firstCall.fxPaths[0]).toContain('transitions')
  })

  it('dernière scène → mixScene appelé avec fxPaths non vide (impacts)', async () => {
    setupHappyPath()
    await step4cAudio.execute(makeCtx())
    const lastCall = mockMixScene.mock.calls[1][0]
    expect(lastCall.fxPaths).toHaveLength(1)
    expect(lastCall.fxPaths[0]).toContain('impacts')
  })

  it('fxIndex absent → outputData.fxIndexMissing=true, fxCount=0', async () => {
    setupHappyPath()
    mockLoadFXIndex.mockResolvedValue([])
    const result = await step4cAudio.execute(makeCtx())
    const data = result.outputData as Record<string, unknown>
    expect(data.fxIndexMissing).toBe(true)
    expect(data.fxCount).toBe(0)
  })

  it('fxIndex absent → mixScene appelé avec fxPaths:[] (dialogue-only)', async () => {
    setupHappyPath()
    mockLoadFXIndex.mockResolvedValue([])
    await step4cAudio.execute(makeCtx())
    for (const call of mockMixScene.mock.calls) {
      expect(call[0].fxPaths).toEqual([])
    }
  })
})

describe('step4cAudio — Music', () => {
  it('musique résolue → mixScene reçoit musicPath non null pour toutes les scènes', async () => {
    setupHappyPath()
    mockResolveMusicFromStructure.mockResolvedValue('/assets/music/tension.wav')
    await step4cAudio.execute(makeCtx())
    for (const call of mockMixScene.mock.calls) {
      expect(call[0].musicPath).toBe('/assets/music/tension.wav')
    }
  })

  it('musique non résolue → mixScene reçoit musicPath null', async () => {
    setupHappyPath()
    mockResolveMusicFromStructure.mockResolvedValue(null)
    await step4cAudio.execute(makeCtx())
    for (const call of mockMixScene.mock.calls) {
      expect(call[0].musicPath).toBeNull()
    }
  })

  it('musicPath dans outputData', async () => {
    setupHappyPath()
    mockResolveMusicFromStructure.mockResolvedValue('/assets/music/calm.wav')
    const result = await step4cAudio.execute(makeCtx())
    const data = result.outputData as Record<string, unknown>
    expect(data.musicPath).toBe('/assets/music/calm.wav')
  })

  it('resolveMusicFromStructure appelé exactement une fois (pas dans la boucle)', async () => {
    setupHappyPath()
    await step4cAudio.execute(makeCtx())
    expect(mockResolveMusicFromStructure).toHaveBeenCalledOnce()
    expect(mockResolveMusicFromStructure).toHaveBeenCalledWith('/tmp/run_test')
  })
})
