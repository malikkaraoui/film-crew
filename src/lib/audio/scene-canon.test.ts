import { describe, expect, it } from 'vitest'
import type { SceneAudioPackage } from '@/types/audio'
import {
  parseAudioMasterManifest,
  parseSceneAudioPackage,
  validateInterSceneCoherence,
} from './scene-canon'

const MINIMAL_VALID_PACKAGE = {
  version: '1.0' as const,
  runId: 'run_test',
  sceneIndex: 0,
  title: "L'appel",
  narration: {
    lines: [{
      lineIndex: 0,
      speaker: 'narrateur',
      text: 'Bonjour.',
      tone: 'neutre',
      pace: 'normal' as const,
      emphasis: [],
      estimatedDurationS: 1.5,
    }],
    silences: [],
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
    intensity: 'subtle' as const,
    stereoWidth: 'narrow' as const,
  },
  fx: [],
  music: {
    mood: 'neutre',
    tempo: 'moderate' as const,
    intensity: 50,
    instrumentation: 'none',
    placement: 'under_dialogue' as const,
    volumeRelativeToDialogue: 'background' as const,
  },
  timing: {
    targetDurationS: 5,
    minDurationS: 3,
    maxDurationS: 8,
    transitionIn: { type: 'cut' as const, durationMs: 0 },
    transitionOut: { type: 'cut' as const, durationMs: 0 },
  },
  dependencies: {
    continuesAmbianceFrom: null,
    continuesMusicFrom: null,
    requiredBeforeScene: [],
    sharedSpeakers: ['narrateur'],
  },
}

const FULL_PACKAGE = {
  ...MINIMAL_VALID_PACKAGE,
  sceneIndex: 1,
  title: 'La tempête',
  narration: {
    lines: [
      {
        lineIndex: 0,
        speaker: 'narrateur',
        text: 'Le vent se leva.',
        tone: 'urgent',
        pace: 'fast' as const,
        emphasis: ['vent'],
        estimatedDurationS: 2.0,
      },
      {
        lineIndex: 1,
        speaker: 'personnage_A',
        text: 'Cours !',
        tone: 'panique',
        pace: 'fast' as const,
        emphasis: ['Cours'],
        estimatedDurationS: 0.8,
      },
    ],
    silences: [{ afterLineIndex: 0, durationS: 0.5, purpose: 'suspense' }],
    stageDirections: 'Voix haletante, montée en intensité',
  },
  intention: {
    emotion: 'urgence',
    narrativeRole: 'climax',
    tensionLevel: 85,
    videoPromptHint: 'Tempête, éclairs, plan serré visage',
  },
  ambiance: {
    description: 'vent violent, pluie battante',
    intensity: 'dominant' as const,
    stereoWidth: 'immersive' as const,
    sourceHint: 'freesound:storm-01',
  },
  fx: [
    {
      triggerAt: 'with_line' as const,
      lineIndex: 0,
      description: 'rafale de vent',
      intensity: 'hard' as const,
    },
    {
      triggerAt: 'end' as const,
      description: 'tonnerre',
      intensity: 'hard' as const,
    },
  ],
  music: {
    mood: 'tension extrême',
    tempo: 'fast' as const,
    intensity: 90,
    instrumentation: 'orchestre percussif',
    placement: 'full_scene' as const,
    volumeRelativeToDialogue: 'equal' as const,
    buildUp: { from: 60, to: 95, curve: 'exponential' as const },
  },
  timing: {
    targetDurationS: 6,
    minDurationS: 4,
    maxDurationS: 9,
    transitionIn: { type: 'crossfade' as const, durationMs: 500 },
    transitionOut: { type: 'fade_out' as const, durationMs: 800 },
  },
  dependencies: {
    continuesAmbianceFrom: 0,
    continuesMusicFrom: 0,
    requiredBeforeScene: [0],
    sharedSpeakers: ['narrateur'],
  },
}

describe('parseSceneAudioPackage', () => {
  it('valide un package minimal', () => {
    const result = parseSceneAudioPackage(MINIMAL_VALID_PACKAGE)
    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.version).toBe('1.0')
      expect(result.data.narration.lines).toHaveLength(1)
    }
  })

  it('valide un package complet', () => {
    const result = parseSceneAudioPackage(FULL_PACKAGE)
    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.fx).toHaveLength(2)
      expect(result.data.music.buildUp?.curve).toBe('exponential')
    }
  })

  it('rejette sans narration.lines', () => {
    const result = parseSceneAudioPackage({
      ...MINIMAL_VALID_PACKAGE,
      narration: { ...MINIMAL_VALID_PACKAGE.narration, lines: [] },
    })
    expect(result.success).toBe(false)
  })

  it('rejette tensionLevel hors bornes', () => {
    const result = parseSceneAudioPackage({
      ...MINIMAL_VALID_PACKAGE,
      intention: { ...MINIMAL_VALID_PACKAGE.intention, tensionLevel: 150 },
    })
    expect(result.success).toBe(false)
  })

  it('rejette timing incohérent (min > target)', () => {
    const result = parseSceneAudioPackage({
      ...MINIMAL_VALID_PACKAGE,
      timing: { ...MINIMAL_VALID_PACKAGE.timing, minDurationS: 10, targetDurationS: 5, maxDurationS: 15 },
    })
    expect(result.success).toBe(false)
  })

  it('rejette FX with_line sans lineIndex', () => {
    const result = parseSceneAudioPackage({
      ...MINIMAL_VALID_PACKAGE,
      fx: [{ triggerAt: 'with_line', description: 'boom', intensity: 'hard' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejette un objet vide', () => {
    const result = parseSceneAudioPackage({})
    expect(result.success).toBe(false)
  })

  it('rejette version incorrecte', () => {
    const result = parseSceneAudioPackage({ ...MINIMAL_VALID_PACKAGE, version: '2.0' })
    expect(result.success).toBe(false)
  })

  it('retourne des messages d\'erreur lisibles', () => {
    const result = parseSceneAudioPackage({ version: '1.0', sceneIndex: 0 })
    expect(result.success).toBe(false)

    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain(':')
    }
  })
})

describe('parseAudioMasterManifest', () => {
  const VALID_MANIFEST = {
    version: '1.0' as const,
    runId: 'run_test',
    totalDurationS: 11,
    sampleRate: 44100,
    channels: 2,
    masterFilePath: '/tmp/master.wav',
    scenes: [{
      sceneIndex: 0,
      startS: 0,
      endS: 5,
      durationS: 5,
      ttsFilePath: '/tmp/0/tts.wav',
      mixFilePath: '/tmp/0/mix.wav',
      status: 'assembled' as const,
      ttsProvider: 'kokoro-local',
      costEur: 0,
    }, {
      sceneIndex: 1,
      startS: 5,
      endS: 11,
      durationS: 6,
      ttsFilePath: '/tmp/1/tts.wav',
      mixFilePath: '/tmp/1/mix.wav',
      status: 'assembled' as const,
      ttsProvider: 'kokoro-local',
      costEur: 0,
    }],
    qualityChecks: { allScenesRendered: true, totalCostEur: 0 },
    generatedAt: '2026-04-24T10:00:00Z',
  }

  it('valide un manifest complet', () => {
    const result = parseAudioMasterManifest(VALID_MANIFEST)
    expect(result.success).toBe(true)
  })

  it('valide un manifest vide (0 scènes)', () => {
    const result = parseAudioMasterManifest({ ...VALID_MANIFEST, totalDurationS: 0, scenes: [] })
    expect(result.success).toBe(true)
  })

  it('rejette startS >= endS', () => {
    const result = parseAudioMasterManifest({
      ...VALID_MANIFEST,
      scenes: [{ ...VALID_MANIFEST.scenes[0], startS: 5, endS: 5 }],
    })
    expect(result.success).toBe(false)
  })

  it('valide avec sttValidation', () => {
    const result = parseAudioMasterManifest({
      ...VALID_MANIFEST,
      qualityChecks: {
        ...VALID_MANIFEST.qualityChecks,
        sttValidation: { enabled: true, wer: 0.05, provider: 'faster-whisper' },
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('validateInterSceneCoherence', () => {
  it('accepte 2 scènes cohérentes', () => {
    const packages = [
      MINIMAL_VALID_PACKAGE as SceneAudioPackage,
      { ...FULL_PACKAGE, dependencies: { ...FULL_PACKAGE.dependencies } } as SceneAudioPackage,
    ]

    const errors = validateInterSceneCoherence(packages)
    expect(errors).toEqual([])
  })

  it('détecte référence ambiance vers scène inexistante', () => {
    const bad = {
      ...MINIMAL_VALID_PACKAGE,
      dependencies: { ...MINIMAL_VALID_PACKAGE.dependencies, continuesAmbianceFrom: 99 },
    } as SceneAudioPackage

    const errors = validateInterSceneCoherence([bad])
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('inexistante')
  })

  it('détecte auto-référence', () => {
    const bad = {
      ...MINIMAL_VALID_PACKAGE,
      dependencies: { ...MINIMAL_VALID_PACKAGE.dependencies, continuesAmbianceFrom: 0 },
    } as SceneAudioPackage

    const errors = validateInterSceneCoherence([bad])
    expect(errors.some((error) => error.includes('auto-référence'))).toBe(true)
  })

  it('détecte sceneIndex en doublon', () => {
    const first = { ...MINIMAL_VALID_PACKAGE } as SceneAudioPackage
    const second = { ...MINIMAL_VALID_PACKAGE } as SceneAudioPackage

    const errors = validateInterSceneCoherence([first, second])
    expect(errors.some((error) => error.includes('doublon'))).toBe(true)
  })

  it('détecte sharedSpeaker absent des lignes', () => {
    const bad = {
      ...MINIMAL_VALID_PACKAGE,
      dependencies: { ...MINIMAL_VALID_PACKAGE.dependencies, sharedSpeakers: ['fantome'] },
    } as SceneAudioPackage

    const errors = validateInterSceneCoherence([bad])
    expect(errors.some((error) => error.includes('fantome'))).toBe(true)
  })
})