import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import { EventEmitter } from 'events'

// ─── Mocks déclarés avant tout import de module ───

vi.mock('../subtitle-generator')
vi.mock('../ffmpeg-media')
vi.mock('../ffmpeg-graph')
vi.mock('../ffmpeg-transitions', () => ({
  sanitizeTransitionConfig: vi.fn(),
  DEFAULT_TRANSITION: 'fade',
  DEFAULT_TRANSITION_DURATION: 0.5,
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined), // tous les fichiers "existent" par défaut
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('child_process', () => ({
  spawn: vi.fn().mockImplementation(() => {
    const proc = new EventEmitter() as NodeJS.EventEmitter & { stderr: EventEmitter }
    proc.stderr = new EventEmitter()
    process.nextTick(() => proc.emit('close', 0))
    return proc
  }),
}))

import { readFile, writeFile, access } from 'fs/promises'
import { generateSubtitles } from '../subtitle-generator'
import { detectEncoder, encoderArgs, probeMediaDuration, checkLibass } from '../ffmpeg-media'
import { buildFilterGraph } from '../ffmpeg-graph'
import { sanitizeTransitionConfig } from '../ffmpeg-transitions'
import { step7Preview } from './step-7-preview'
import type { StepContext } from '../types'
import type { StyleTemplate } from '@/lib/templates/loader'

// ─── Mocks typés ───

const mockReadFile = readFile as MockedFunction<typeof readFile>
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>
const mockAccess = access as MockedFunction<typeof access>
const mockGenerateSubtitles = generateSubtitles as MockedFunction<typeof generateSubtitles>
const mockDetectEncoder = detectEncoder as MockedFunction<typeof detectEncoder>
const mockEncoderArgs = encoderArgs as MockedFunction<typeof encoderArgs>
const mockProbeMediaDuration = probeMediaDuration as MockedFunction<typeof probeMediaDuration>
const mockCheckLibass = checkLibass as MockedFunction<typeof checkLibass>
const mockBuildFilterGraph = buildFilterGraph as MockedFunction<typeof buildFilterGraph>
const mockSanitizeTransitionConfig = sanitizeTransitionConfig as MockedFunction<typeof sanitizeTransitionConfig>

// ─── Fixtures ───

const GEN_MANIFEST_CLIP = JSON.stringify({
  clips: [{ sceneIndex: 0, filePath: '/tmp/run/clips/scene0.mp4' }],
  audioPath: '/tmp/run/audio/master.wav',
  musicPath: null,
})
const GEN_MANIFEST_EMPTY = JSON.stringify({
  clips: [],
  audioPath: null,
  musicPath: null,
})

function makeCtx(storagePath = '/tmp/run_test'): StepContext {
  return { runId: 'run_test', chainId: null, idea: 'test', brandKitPath: null, storagePath, intentionPath: null, template: null }
}

const BASE_TEMPLATE: StyleTemplate = {
  id: 'test', name: 'Test', description: '', style: '', rhythm: '',
  transitions: [], subtitleStyle: '', agentTones: {}, promptPrefix: '',
}

/** Configure les mocks ffmpeg pour un assemblage qui réussit silencieusement. */
function setupFFmpegMocks() {
  mockDetectEncoder.mockResolvedValue('libx264')
  mockEncoderArgs.mockReturnValue(['-c:v', 'libx264'])
  mockProbeMediaDuration.mockResolvedValue(10)
  mockCheckLibass.mockResolvedValue(false)
  mockBuildFilterGraph.mockReturnValue({ args: [], needsReencode: false })
  mockSanitizeTransitionConfig.mockReturnValue({
    enabled: false,
    config: { type: 'fade', duration: 0.5 },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAccess.mockResolvedValue(undefined) // reset : tous les fichiers existent
  delete process.env.ENABLE_SUBTITLES
})

// ─── Cas 1 : manifest manquant ───

describe('step7Preview — manifest introuvable', () => {
  it('retourne success=false si generation-manifest.json absent', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    const result = await step7Preview.execute(makeCtx())
    expect(result.success).toBe(false)
    expect(result.error).toContain('generation-manifest.json')
  })
})

// ─── Cas 2 : sélection du mode media ───

describe('step7Preview — mode media', () => {
  it('clips=[] + pas de storyboard → mode=none, success=true', async () => {
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_EMPTY as never)
      .mockRejectedValueOnce(new Error('ENOENT')) // storyboard/manifest.json absent
    const result = await step7Preview.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).mode).toBe('none')
  })

  it('clips=[] + storyboard images generated + images absentes → mode=storyboard_only', async () => {
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_EMPTY as never)
      .mockResolvedValueOnce(JSON.stringify({
        images: [{ sceneIndex: 0, filePath: '/tmp/storyboard/0.png', status: 'generated' }],
      }) as never)
    // images absentes sur disque → realImages=[], fallback storyboard_only
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    const result = await step7Preview.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).mode).toBe('storyboard_only')
  })

  it('1 clip valide + audio → mode=video_finale, playable=true', async () => {
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_CLIP as never)
      .mockRejectedValueOnce(new Error('ENOENT'))
    mockAccess.mockResolvedValue(undefined) // clip + audio + output existent
    setupFFmpegMocks()
    const result = await step7Preview.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).mode).toBe('video_finale')
    expect((result.outputData as Record<string, unknown>).playable).toBe(true)
  })
})

// ─── Cas 3 : intégration sous-titres ───

describe('step7Preview — sous-titres', () => {
  it('ENABLE_SUBTITLES absent → generateSubtitles pas appelé', async () => {
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_CLIP as never)
      .mockRejectedValueOnce(new Error('ENOENT'))
    mockAccess.mockResolvedValue(undefined)
    setupFFmpegMocks()
    mockGenerateSubtitles.mockResolvedValue({ srtPath: '/final/subs.srt', source: 'whisper' })

    await step7Preview.execute(makeCtx())

    expect(mockGenerateSubtitles).not.toHaveBeenCalled()
  })

  it('ENABLE_SUBTITLES=true + hasAudio=true → generateSubtitles appelé avec les bons params', async () => {
    process.env.ENABLE_SUBTITLES = 'true'
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_CLIP as never)
      .mockRejectedValueOnce(new Error('ENOENT'))
    mockAccess.mockResolvedValue(undefined)
    setupFFmpegMocks()
    mockGenerateSubtitles.mockResolvedValue(null)

    await step7Preview.execute(makeCtx())

    expect(mockGenerateSubtitles).toHaveBeenCalledWith({
      audioPath: '/tmp/run/audio/master.wav',
      storagePath: '/tmp/run_test',
      outputDir: '/tmp/run_test/final',
      runId: 'run_test',
    })
  })

  it('generateSubtitles retourne résultat → srtPath + subtitleSource dans manifest', async () => {
    process.env.ENABLE_SUBTITLES = 'true'
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_CLIP as never)
      .mockRejectedValueOnce(new Error('ENOENT'))
    mockAccess.mockResolvedValue(undefined)
    setupFFmpegMocks()
    mockCheckLibass.mockResolvedValue(true) // libass dispo → subtitlesEnabled
    mockGenerateSubtitles.mockResolvedValue({
      srtPath: '/tmp/run_test/final/subtitles.srt',
      source: 'whisper',
    })

    await step7Preview.execute(makeCtx())

    const manifestCall = mockWriteFile.mock.calls.find(
      ([path]) => (path as string).endsWith('preview-manifest.json'),
    )
    expect(manifestCall).toBeDefined()
    const manifest = JSON.parse(manifestCall![1] as string)
    expect(manifest.srtPath).toBe('/tmp/run_test/final/subtitles.srt')
    expect(manifest.subtitleSource).toBe('whisper')
  })

  it('generateSubtitles retourne null → srtPath null dans manifest, success=true', async () => {
    process.env.ENABLE_SUBTITLES = 'true'
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_CLIP as never)
      .mockRejectedValueOnce(new Error('ENOENT'))
    mockAccess.mockResolvedValue(undefined)
    setupFFmpegMocks()
    mockGenerateSubtitles.mockResolvedValue(null)

    const result = await step7Preview.execute(makeCtx())

    expect(result.success).toBe(true)
    const manifestCall = mockWriteFile.mock.calls.find(
      ([path]) => (path as string).endsWith('preview-manifest.json'),
    )
    const manifest = JSON.parse(manifestCall![1] as string)
    expect(manifest.srtPath).toBeNull()
    expect(manifest.subtitleSource).toBeNull()
  })

  it('template.enableSubtitles=true + hasAudio → generateSubtitles appelé (sans env var)', async () => {
    // Pas de ENABLE_SUBTITLES — le template suffit
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_CLIP as never)
      .mockRejectedValueOnce(new Error('ENOENT'))
    mockAccess.mockResolvedValue(undefined)
    setupFFmpegMocks()
    mockGenerateSubtitles.mockResolvedValue(null)

    const ctx = { ...makeCtx(), template: { ...BASE_TEMPLATE, enableSubtitles: true } }
    await step7Preview.execute(ctx)

    expect(mockGenerateSubtitles).toHaveBeenCalled()
  })

  it('ENABLE_SUBTITLES=true + hasAudio=false → generateSubtitles pas appelé', async () => {
    process.env.ENABLE_SUBTITLES = 'true'
    mockReadFile
      .mockResolvedValueOnce(GEN_MANIFEST_EMPTY as never) // audioPath: null
      .mockRejectedValueOnce(new Error('ENOENT'))
    mockAccess.mockResolvedValue(undefined)
    mockGenerateSubtitles.mockResolvedValue({ srtPath: '/final/subs.srt', source: 'whisper' })

    await step7Preview.execute(makeCtx())

    expect(mockGenerateSubtitles).not.toHaveBeenCalled()
  })
})
