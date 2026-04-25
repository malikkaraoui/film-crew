/**
 * E2E audio-first : step-4c → step-6 → step-7
 *
 * Traversée complète avec vraie fs (mkdtemp / rm recursive).
 * TTS, providers audio, DB, FFmpeg et subtitle-generator mockés.
 * assembleMaster mock écrit audio-master-manifest.json + master.wav sur disque,
 * ce qui permet à step-6 et step-7 de lire des artefacts réels.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'

// ─── Mocks globaux (hoistés avant tout import de module) ──────────────────────

vi.mock('@/lib/pipeline/tts-renderer')
vi.mock('@/lib/audio/tts-render')
vi.mock('@/lib/audio/mix-scene')
vi.mock('@/lib/audio/mix-master')
vi.mock('@/lib/audio/fx-library')
vi.mock('@/lib/audio/ambiance-library')
vi.mock('@/lib/audio/ambiance-selector')
vi.mock('@/lib/audio/scene-assets')
vi.mock('@/lib/audio/stt-validation')
vi.mock('@/lib/runs/project-config')
vi.mock('@/lib/db/connection', () => ({
  db: { insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) },
}))
vi.mock('@/lib/db/schema', () => ({ clip: 'clip' }))
vi.mock('@/lib/pipeline/subtitle-generator')
vi.mock('@/lib/providers/failover')
vi.mock('@/lib/pipeline/provider-prompting', () => ({
  resolveProviderPrompt: (_m: unknown, _p: unknown, prompt: string) => prompt,
}))
vi.mock('@/lib/pipeline/ffmpeg-media', () => ({
  detectEncoder: vi.fn().mockResolvedValue('libx264'),
  encoderArgs: vi.fn().mockReturnValue(['-c:v', 'libx264']),
  probeMediaDuration: vi.fn().mockResolvedValue(10),
  checkLibass: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/pipeline/ffmpeg-graph', () => ({
  buildFilterGraph: vi.fn().mockReturnValue({ args: [] }),
}))
vi.mock('@/lib/pipeline/ffmpeg-transitions', () => ({
  sanitizeTransitionConfig: vi.fn().mockReturnValue({ enabled: false, config: { type: 'fade', duration: 0.5 } }),
  DEFAULT_TRANSITION: 'fade',
  DEFAULT_TRANSITION_DURATION: 0.5,
}))
vi.mock('child_process', () => ({
  spawn: vi.fn().mockImplementation(() => {
    const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    proc.stderr = new EventEmitter()
    process.nextTick(() => proc.emit('close', 0))
    return proc
  }),
}))
vi.mock('@/lib/publishers/tiktok')
vi.mock('@/lib/publishers/factory')
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ─── Imports après mocks ──────────────────────────────────────────────────────

import { renderDialogueToTTS } from '@/lib/pipeline/tts-renderer'
import { assembleSceneTTS } from '@/lib/audio/tts-render'
import { mixScene } from '@/lib/audio/mix-scene'
import { assembleMaster } from '@/lib/audio/mix-master'
import { loadFXIndex } from '@/lib/audio/fx-library'
import { loadAmbianceIndex } from '@/lib/audio/ambiance-library'
import { selectAmbianceForScene } from '@/lib/audio/ambiance-selector'
import { resolveMusicFromStructure } from '@/lib/audio/scene-assets'
import { readProjectConfig } from '@/lib/runs/project-config'
import { generateSubtitles } from '@/lib/pipeline/subtitle-generator'
import { savePublishResult } from '@/lib/publishers/tiktok'
import { publishToPlatform, upsertPublishManifest } from '@/lib/publishers/factory'
import { step4cAudio } from '../steps/step-4c-audio'
import { step6Generation } from '../steps/step-6-generation'
import { step7Preview } from '../steps/step-7-preview'
import { step8Publish } from '../steps/step-8-publish'
import type { StepContext } from '../types'
import type { DialogueScript } from '@/types/audio'
import type { TTSManifest } from '@/lib/pipeline/tts-renderer'
import type { PublishResult } from '@/lib/publishers/tiktok'
import type { PublishManifest } from '@/lib/publishers/platform-types'

// ─── Typed mocks ──────────────────────────────────────────────────────────────

const mockRenderDialogueToTTS = renderDialogueToTTS as MockedFunction<typeof renderDialogueToTTS>
const mockAssembleSceneTTS = assembleSceneTTS as MockedFunction<typeof assembleSceneTTS>
const mockMixScene = mixScene as MockedFunction<typeof mixScene>
const mockAssembleMaster = assembleMaster as MockedFunction<typeof assembleMaster>
const mockLoadFXIndex = loadFXIndex as MockedFunction<typeof loadFXIndex>
const mockLoadAmbianceIndex = loadAmbianceIndex as MockedFunction<typeof loadAmbianceIndex>
const mockSelectAmbianceForScene = selectAmbianceForScene as MockedFunction<typeof selectAmbianceForScene>
const mockResolveMusicFromStructure = resolveMusicFromStructure as MockedFunction<typeof resolveMusicFromStructure>
const mockReadProjectConfig = readProjectConfig as MockedFunction<typeof readProjectConfig>
const mockGenerateSubtitles = generateSubtitles as MockedFunction<typeof generateSubtitles>
const mockPublishToPlatform = publishToPlatform as MockedFunction<typeof publishToPlatform>
const mockSavePublishResult = savePublishResult as MockedFunction<typeof savePublishResult>
const mockUpsertPublishManifest = upsertPublishManifest as MockedFunction<typeof upsertPublishManifest>

// ─── Fixtures minimales (1 scène, 1 ligne) ────────────────────────────────────

const MINIMAL_SCRIPT: DialogueScript = {
  runId: 'e2e-audio',
  language: 'fr',
  totalDurationTargetS: 10,
  scenes: [
    {
      sceneIndex: 0,
      title: 'Scène test',
      durationTargetS: 10,
      stageDirections: '',
      lines: [
        {
          lineIndex: 0,
          speaker: 'narrateur',
          text: 'Bonjour le monde.',
          tone: 'neutre',
          pace: 'normal',
          emphasis: [],
          estimatedDurationS: 2.0,
        },
      ],
      silences: [],
    },
  ],
}

const MINIMAL_STRUCTURE = {
  scenes: [{ sceneIndex: 0, dialogue: 'Bonjour le monde.' }],
}

const TTS_MANIFEST: TTSManifest = {
  runId: 'e2e-audio',
  provider: 'kokoro-local',
  voice: 'default',
  language: 'fr',
  lines: [
    { sceneIndex: 0, lineIndex: 0, speaker: 'narrateur', filePath: 'tts-s0-l0.wav', durationS: 2.0 },
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function writeFixtures(dir: string): Promise<void> {
  await writeFile(join(dir, 'dialogue_script.json'), JSON.stringify(MINIMAL_SCRIPT))
  await writeFile(join(dir, 'structure.json'), JSON.stringify(MINIMAL_STRUCTURE))
}

function makeCtx(storagePath: string, template: Record<string, unknown> | null = null): StepContext {
  return {
    runId: 'e2e-audio',
    chainId: null,
    idea: 'Test E2E audio-first',
    brandKitPath: null,
    storagePath,
    intentionPath: null,
    template: template as unknown as StepContext['template'],
  }
}

// ─── assembleMaster mock avec écriture disque ─────────────────────────────────
// Écrit audio-master-manifest.json + master.wav dans outputDir (vraie fs).
// Nécessaire pour que step-6 lise le manifest et que step-7 confirme hasAudio=true.

type AssembleMasterArgs = { outputDir: string; runId: string; scenes: unknown[] }

async function assembleMasterToDisc({ outputDir, runId: rid }: AssembleMasterArgs) {
  const masterPath = join(outputDir, 'master.wav')
  const manifest = {
    version: '1.0' as const,
    runId: rid,
    totalDurationS: 2.0,
    sampleRate: 44100,
    channels: 1,
    masterFilePath: masterPath,
    scenes: [],
    qualityChecks: { allScenesRendered: true, totalCostEur: 0 },
    generatedAt: new Date().toISOString(),
  }
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, 'audio-master-manifest.json'), JSON.stringify(manifest, null, 2))
  // 44 octets = taille minimale d'un header WAV — suffisant pour que fileExists retourne true
  await writeFile(masterPath, Buffer.alloc(44))
  return manifest
}

function setupAudioMocks(storagePath: string): void {
  const audioDir = join(storagePath, 'audio')

  mockRenderDialogueToTTS.mockResolvedValue(TTS_MANIFEST)
  mockLoadFXIndex.mockResolvedValue([])
  mockLoadAmbianceIndex.mockResolvedValue([])
  mockSelectAmbianceForScene.mockReturnValue(null)
  mockResolveMusicFromStructure.mockResolvedValue(null)
  mockMixScene.mockResolvedValue(undefined)

  mockAssembleSceneTTS.mockImplementation(async ({ scene }: { scene: { sceneIndex: number } }) => ({
    sceneIndex: scene.sceneIndex,
    concatFilePath: join(audioDir, 'scenes', String(scene.sceneIndex), 'tts.wav'),
    totalDurationS: 2.0,
    lineCount: 1,
    silenceCount: 0,
    provider: 'kokoro-local',
    costEur: 0,
  }))

  // assembleMaster écrit les fichiers réels sur disque pour la suite de la chaîne
  mockAssembleMaster.mockImplementation(assembleMasterToDisc)
  mockReadProjectConfig.mockResolvedValue(null)
  mockGenerateSubtitles.mockResolvedValue(null)
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('E2E audio-first — step-4c → step-6 → step-7', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'e2e-audio-'))
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('chemin_nominal — preview-manifest.json avec mode=none, hasAudio=true, audioPath→master.wav', async () => {
    await writeFixtures(tmpDir)
    setupAudioMocks(tmpDir)

    const ctx = makeCtx(tmpDir)

    // step-4c : génère audio-master-manifest.json + master.wav (via mock assembleMaster)
    const r4c = await step4cAudio.execute(ctx)
    expect(r4c.success).toBe(true)

    // step-6 : lit le manifest audio réel, écrit generation-manifest.json
    const r6 = await step6Generation.execute(ctx)
    expect(r6.success).toBe(true)
    const r6Data = r6.outputData as Record<string, unknown>
    expect(r6Data.hasAudio).toBe(true)

    // step-7 : lit generation-manifest réel, écrit preview-manifest.json
    const r7 = await step7Preview.execute(ctx)
    expect(r7.success).toBe(true)

    // Vérification du preview-manifest.json sur disque
    const raw = await readFile(join(tmpDir, 'preview-manifest.json'), 'utf-8')
    const manifest = JSON.parse(raw) as {
      mode: string
      hasAudio: boolean
      audioPath: string | null
    }

    expect(manifest.mode).toBe('none')
    expect(manifest.hasAudio).toBe(true)
    expect(typeof manifest.audioPath).toBe('string')
    expect(manifest.audioPath).toContain('master.wav')
  })

  it('sous-titres_e2e — srtPath et subtitleSource présents dans preview-manifest.json', async () => {
    await writeFixtures(tmpDir)
    setupAudioMocks(tmpDir)

    const finalDir = join(tmpDir, 'final')
    const fakeSrtPath = join(finalDir, 'preview.srt')
    mockGenerateSubtitles.mockResolvedValue({ srtPath: fakeSrtPath, source: 'whisper' })

    // template avec enableSubtitles: true → step-7 appelle generateSubtitles si hasAudio
    const ctx = makeCtx(tmpDir, { enableSubtitles: true })

    await step4cAudio.execute(ctx)
    await step6Generation.execute(ctx)
    await step7Preview.execute(ctx)

    const raw = await readFile(join(tmpDir, 'preview-manifest.json'), 'utf-8')
    const manifest = JSON.parse(raw) as {
      srtPath: string | null
      subtitleSource: string | null
    }

    expect(manifest.srtPath).toBe(fakeSrtPath)
    expect(manifest.subtitleSource).toBe('whisper')
  })
})

// ─── E2E preview → publish ────────────────────────────────────────────────────

describe('E2E preview → publish', () => {
  let tmpDir: string

  const NO_CRED_RESULT: PublishResult = {
    platform: 'tiktok',
    status: 'NO_CREDENTIALS',
    credentials: { hasAccessToken: false, hasClientKey: false },
    runId: 'e2e-audio',
    title: 'Ma vidéo E2E',
    hashtags: ['#shorts', '#ai', '#filmcrew'],
    mediaMode: 'none',
  }

  const DUMMY_MANIFEST: PublishManifest = {
    runId: 'e2e-audio',
    version: 1,
    title: 'Ma vidéo E2E',
    hashtags: ['#shorts'],
    platforms: [],
    generatedAt: new Date().toISOString(),
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'e2e-publish-'))
    vi.clearAllMocks()
    mockPublishToPlatform.mockResolvedValue(NO_CRED_RESULT)
    mockSavePublishResult.mockResolvedValue(undefined)
    mockUpsertPublishManifest.mockResolvedValue(DUMMY_MANIFEST)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('step-7 écrit preview-manifest.json → step-8 lit + écrit metadata.json + appelle publishToPlatform', async () => {
    // Préparer les fichiers d'entrée de step-7 sur disque
    await writeFixtures(tmpDir)
    setupAudioMocks(tmpDir)

    const ctx = makeCtx(tmpDir)

    // step-4c → step-6 → step-7 : chaîne audio-first complète
    await step4cAudio.execute(ctx)
    await step6Generation.execute(ctx)
    await step7Preview.execute(ctx)

    // Vérifier que preview-manifest.json est bien sur disque avant step-8
    const preview = JSON.parse(
      await readFile(join(tmpDir, 'preview-manifest.json'), 'utf-8'),
    ) as { mode: string; hasAudio: boolean }
    expect(preview.mode).toBe('none')
    expect(preview.hasAudio).toBe(true)

    // Écrire structure.json pour que step-8 dispose d'un titre
    await writeFile(join(tmpDir, 'structure.json'), JSON.stringify({ title: 'Ma vidéo E2E', scenes: [] }))

    // step-8 : lit preview-manifest.json réel, écrit metadata.json sur disque
    const r8 = await step8Publish.execute(ctx)
    expect(r8.success).toBe(true)

    // metadata.json écrit sur disque réel dans final/
    const raw = await readFile(join(tmpDir, 'final', 'metadata.json'), 'utf-8')
    const meta = JSON.parse(raw) as { title: string; mode: string; platforms: unknown }
    expect(meta.title).toBe('Ma vidéo E2E')
    expect(meta.mode).toBe('none')
    expect(meta.platforms).toBeDefined()

    // publishToPlatform appelé avec les bons paramètres
    expect(mockPublishToPlatform).toHaveBeenCalledOnce()
    const [platform, opts] = mockPublishToPlatform.mock.calls[0]
    expect(platform).toBe('tiktok')
    expect(opts.runId).toBe('e2e-audio')
    expect(opts.title).toBe('Ma vidéo E2E')
  })
})
