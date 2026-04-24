import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SceneAudioPackage } from '@/types/audio'
import type { TTSManifest } from '@/lib/pipeline/tts-renderer'

// ─── Mocks ───

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require('events')
    const proc = new EventEmitter()
    proc.stderr = new EventEmitter()
    setTimeout(() => proc.emit('close', 0), 10)
    return proc
  }),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  copyFile: vi.fn(async () => undefined),
}))

// ─── Fixtures ───

function makeScene(overrides: Partial<SceneAudioPackage> = {}): SceneAudioPackage {
  return {
    version: '1.0',
    runId: 'run_test',
    sceneIndex: 0,
    title: "L'appel",
    narration: {
      lines: [
        {
          lineIndex: 0,
          speaker: 'narrateur',
          text: 'Bonjour.',
          tone: 'neutre',
          pace: 'normal',
          emphasis: [],
          estimatedDurationS: 1.5,
        },
        {
          lineIndex: 1,
          speaker: 'narrateur',
          text: 'Bonsoir.',
          tone: 'neutre',
          pace: 'normal',
          emphasis: [],
          estimatedDurationS: 1.2,
        },
      ],
      silences: [
        { afterLineIndex: 0, durationS: 0.5, purpose: 'respiration' },
      ],
      stageDirections: '',
    },
    intention: {
      emotion: 'neutre',
      narrativeRole: 'exposition',
      tensionLevel: 50,
      videoPromptHint: 'Plan large',
    },
    ambiance: {
      description: 'silence urbain',
      intensity: 'subtle',
      stereoWidth: 'narrow',
    },
    fx: [],
    music: {
      mood: 'neutre',
      tempo: 'moderate',
      intensity: 30,
      instrumentation: 'piano solo',
      placement: 'under_dialogue',
      volumeRelativeToDialogue: 'background',
    },
    timing: {
      targetDurationS: 10,
      minDurationS: 5,
      maxDurationS: 15,
      transitionIn: { type: 'cut', durationMs: 0 },
      transitionOut: { type: 'fade_out', durationMs: 500 },
    },
    dependencies: {
      continuesAmbianceFrom: null,
      continuesMusicFrom: null,
      requiredBeforeScene: [],
      sharedSpeakers: [],
    },
    ...overrides,
  }
}

function makeManifest(overrides: Partial<TTSManifest> = {}): TTSManifest {
  return {
    runId: 'run_test',
    provider: 'kokoro-local',
    voice: 'default',
    language: 'fr',
    lines: [
      {
        sceneIndex: 0,
        lineIndex: 0,
        speaker: 'narrateur',
        filePath: 'tts-scene0-line0.wav',
        durationS: 1.5,
      },
      {
        sceneIndex: 0,
        lineIndex: 1,
        speaker: 'narrateur',
        filePath: 'tts-scene0-line1.wav',
        durationS: 1.2,
      },
    ],
    ...overrides,
  }
}

// ─── Tests ───

describe('assembleSceneTTS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('assemble une scene avec lignes et silences', async () => {
    const { assembleSceneTTS } = await import('./tts-render')

    const result = await assembleSceneTTS({
      scene: makeScene(),
      ttsManifest: makeManifest(),
      ttsDir: '/tmp/tts',
      outputDir: '/tmp/output',
    })

    expect(result.sceneIndex).toBe(0)
    expect(result.lineCount).toBe(2)
    expect(result.silenceCount).toBe(1)
    expect(result.totalDurationS).toBe(3.2) // 1.5 + 0.5 + 1.2
    expect(result.concatFilePath).toContain('tts-scene0.wav')
    expect(result.provider).toBe('kokoro-local')
    expect(result.costEur).toBe(0)
  })

  it('scene sans silences — pas de generation de silence', async () => {
    const { spawn } = await import('child_process')
    const { assembleSceneTTS } = await import('./tts-render')

    const scene = makeScene({
      narration: {
        lines: [
          {
            lineIndex: 0,
            speaker: 'narrateur',
            text: 'Bonjour.',
            tone: 'neutre',
            pace: 'normal',
            emphasis: [],
            estimatedDurationS: 1.5,
          },
        ],
        silences: [],
        stageDirections: '',
      },
    })

    const manifest = makeManifest({
      lines: [
        {
          sceneIndex: 0,
          lineIndex: 0,
          speaker: 'narrateur',
          filePath: 'tts-scene0-line0.wav',
          durationS: 1.5,
        },
      ],
    })

    const result = await assembleSceneTTS({
      scene,
      ttsManifest: manifest,
      ttsDir: '/tmp/tts',
      outputDir: '/tmp/output',
    })

    expect(result.silenceCount).toBe(0)
    expect(result.lineCount).toBe(1)
    expect(result.totalDurationS).toBe(1.5)

    // Single segment: should use copyFile, NOT spawn for concat
    // spawn should not have been called at all (no silence, no concat)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('throw si 0 lignes matchent la scene', async () => {
    const { assembleSceneTTS } = await import('./tts-render')

    const scene = makeScene({ sceneIndex: 5 })
    const manifest = makeManifest() // lines only for sceneIndex 0

    await expect(
      assembleSceneTTS({
        scene,
        ttsManifest: manifest,
        ttsDir: '/tmp/tts',
        outputDir: '/tmp/output',
      }),
    ).rejects.toThrow('No TTS lines found for scene 5')
  })
})
