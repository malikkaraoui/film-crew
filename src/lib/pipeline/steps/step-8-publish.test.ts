import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import { join } from 'path'

// ─── Mocks (avant tout import de module) ──────────────────────────────────────

vi.mock('@/lib/publishers/tiktok')
vi.mock('@/lib/publishers/factory')
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { readFile, writeFile } from 'fs/promises'
import { savePublishResult } from '@/lib/publishers/tiktok'
import { publishToPlatform, upsertPublishManifest } from '@/lib/publishers/factory'
import { step8Publish } from './step-8-publish'
import type { StepContext } from '../types'
import type { PublishResult } from '@/lib/publishers/tiktok'
import type { PublishManifest } from '@/lib/publishers/platform-types'

// ─── Typed mocks ──────────────────────────────────────────────────────────────

const mockReadFile = readFile as MockedFunction<typeof readFile>
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>
const mockSavePublishResult = savePublishResult as MockedFunction<typeof savePublishResult>
const mockPublishToPlatform = publishToPlatform as MockedFunction<typeof publishToPlatform>
const mockUpsertPublishManifest = upsertPublishManifest as MockedFunction<typeof upsertPublishManifest>

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type PreviewFixture = {
  mode: 'video_finale' | 'animatic' | 'storyboard_only' | 'none'
  playableFilePath: string | null
  mediaType: string | null
  readyForAssembly: boolean
  hasAudio: boolean
}

const PREVIEW_NONE: PreviewFixture = {
  mode: 'none',
  playableFilePath: null,
  mediaType: null,
  readyForAssembly: false,
  hasAudio: false,
}

const PREVIEW_WITH_VIDEO: PreviewFixture = {
  mode: 'video_finale',
  playableFilePath: '/tmp/run_test/final/video.mp4',
  mediaType: 'video/mp4',
  readyForAssembly: true,
  hasAudio: true,
}

const NO_CRED_RESULT: PublishResult = {
  platform: 'tiktok',
  status: 'NO_CREDENTIALS',
  credentials: { hasAccessToken: false, hasClientKey: false },
  instructions: 'Configurer TIKTOK_ACCESS_TOKEN',
  runId: 'run_test',
  title: 'Test Title',
  hashtags: ['#shorts', '#ai', '#filmcrew'],
  mediaMode: 'none',
}

const DUMMY_MANIFEST: PublishManifest = {
  runId: 'run_test',
  version: 1,
  title: 'Test Title',
  hashtags: ['#shorts'],
  platforms: [],
  generatedAt: new Date().toISOString(),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(storagePath = '/tmp/run_test'): StepContext {
  return { runId: 'run_test', chainId: null, idea: 'Mon idée', brandKitPath: null, storagePath, intentionPath: null, template: null }
}

/**
 * Configure readFile pour retourner preview-manifest.json + structure.json.
 * structure = 'ENOENT' → simule fichier absent.
 * structure = undefined → retourne { title: 'Test Title', scenes: [] }.
 */
function setupReadFiles(
  preview: PreviewFixture,
  structure?: { title?: string; scenes?: unknown[] } | 'ENOENT',
): void {
  mockReadFile.mockImplementation(async (filePath) => {
    const p = String(filePath)
    if (p.includes('preview-manifest.json')) {
      return JSON.stringify(preview) as never
    }
    if (p.includes('structure.json')) {
      if (structure === 'ENOENT') {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return JSON.stringify(structure ?? { title: 'Test Title', scenes: [] }) as never
    }
    throw new Error(`readFile inattendu : ${filePath}`)
  })
}

function setupPublishers(): void {
  mockPublishToPlatform.mockResolvedValue(NO_CRED_RESULT)
  mockSavePublishResult.mockResolvedValue(undefined)
  mockUpsertPublishManifest.mockResolvedValue(DUMMY_MANIFEST)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Lecture manifest ─────────────────────────────────────────────────────────

describe('step8Publish — lecture manifest', () => {
  it('preview-manifest.json absent → success=false, error tracé', async () => {
    mockReadFile.mockRejectedValue(new Error('file not found'))
    const result = await step8Publish.execute(makeCtx())
    expect(result.success).toBe(false)
    expect(result.error).toContain('preview-manifest.json introuvable')
    expect(result.costEur).toBe(0)
  })

  it('preview-manifest.json présent → success=true', async () => {
    setupReadFiles(PREVIEW_NONE)
    setupPublishers()
    const result = await step8Publish.execute(makeCtx())
    expect(result.success).toBe(true)
  })
})

// ─── mode=none + !playableFilePath ────────────────────────────────────────────

describe('step8Publish — status outputData', () => {
  it('mode=none + playableFilePath=null → status="metadata_only", hasPlayable=false', async () => {
    setupReadFiles(PREVIEW_NONE)
    setupPublishers()
    const result = await step8Publish.execute(makeCtx())
    const data = result.outputData as Record<string, unknown>
    expect(data.status).toBe('metadata_only')
    expect(data.hasPlayable).toBe(false)
    expect(data.mode).toBe('none')
  })

  it('mode=video_finale + playableFilePath présent → status="ready_for_export", hasPlayable=true', async () => {
    setupReadFiles(PREVIEW_WITH_VIDEO)
    setupPublishers()
    const result = await step8Publish.execute(makeCtx())
    const data = result.outputData as Record<string, unknown>
    expect(data.status).toBe('ready_for_export')
    expect(data.hasPlayable).toBe(true)
  })
})

// ─── Résolution videoPath ─────────────────────────────────────────────────────

describe('step8Publish — videoPath', () => {
  it('playableFilePath absolu → conservé tel quel dans publishToPlatform', async () => {
    setupReadFiles(PREVIEW_WITH_VIDEO)
    setupPublishers()
    await step8Publish.execute(makeCtx())
    const [, opts] = mockPublishToPlatform.mock.calls[0]
    expect(opts.videoPath).toBe('/tmp/run_test/final/video.mp4')
  })

  it('playableFilePath relatif → résolu via join(cwd, path)', async () => {
    setupReadFiles({ ...PREVIEW_WITH_VIDEO, playableFilePath: 'final/video.mp4' })
    setupPublishers()
    await step8Publish.execute(makeCtx())
    const [, opts] = mockPublishToPlatform.mock.calls[0]
    expect(opts.videoPath).toBe(join(process.cwd(), 'final/video.mp4'))
  })

  it('playableFilePath=null + mode=video_finale → videoPath = storagePath/final/video.mp4', async () => {
    setupReadFiles({ ...PREVIEW_WITH_VIDEO, playableFilePath: null })
    setupPublishers()
    const ctx = makeCtx('/tmp/run_test')
    await step8Publish.execute(ctx)
    const [, opts] = mockPublishToPlatform.mock.calls[0]
    expect(opts.videoPath).toBe('/tmp/run_test/final/video.mp4')
  })

  it('playableFilePath=null + mode=animatic → videoPath = storagePath/final/animatic.mp4', async () => {
    setupReadFiles({ ...PREVIEW_NONE, mode: 'animatic' })
    setupPublishers()
    const ctx = makeCtx('/tmp/run_test')
    await step8Publish.execute(ctx)
    const [, opts] = mockPublishToPlatform.mock.calls[0]
    expect(opts.videoPath).toBe('/tmp/run_test/final/animatic.mp4')
  })
})

// ─── Fallback titre ───────────────────────────────────────────────────────────

describe('step8Publish — structure.json', () => {
  it('structure.json absent → title = ctx.idea (fallback)', async () => {
    setupReadFiles(PREVIEW_NONE, 'ENOENT')
    setupPublishers()
    const ctx = makeCtx()
    const result = await step8Publish.execute(ctx)
    const data = result.outputData as Record<string, unknown>
    expect(data.title).toBe('Mon idée')
  })

  it('structure.json présent avec title → title utilisé', async () => {
    setupReadFiles(PREVIEW_NONE, { title: 'Ma vidéo TikTok', scenes: [] })
    setupPublishers()
    const result = await step8Publish.execute(makeCtx())
    const data = result.outputData as Record<string, unknown>
    expect(data.title).toBe('Ma vidéo TikTok')
  })
})

// ─── metadata.json ────────────────────────────────────────────────────────────

describe('step8Publish — metadata.json', () => {
  it('writeFile appelé pour metadata.json dans final/', async () => {
    setupReadFiles(PREVIEW_NONE, { title: 'Test Title' })
    setupPublishers()
    await step8Publish.execute(makeCtx('/tmp/run_test'))
    const writeCall = mockWriteFile.mock.calls.find((c) =>
      String(c[0]).includes('metadata.json'),
    )
    expect(writeCall).toBeTruthy()
  })

  it('metadata.json contient title, mode, hashtags et platforms', async () => {
    setupReadFiles(PREVIEW_NONE, { title: 'Test Title' })
    setupPublishers()
    await step8Publish.execute(makeCtx('/tmp/run_test'))
    const writeCall = mockWriteFile.mock.calls.find((c) => String(c[0]).includes('metadata.json'))!
    const content = JSON.parse(String(writeCall[1]))
    expect(content.title).toBe('Test Title')
    expect(content.mode).toBe('none')
    expect(Array.isArray(content.hashtags)).toBe(true)
    expect(typeof content.platforms).toBe('object')
    expect(content.platforms.tiktok).toBeDefined()
  })

  it('metadata.json écrit dans storagePath/final/', async () => {
    setupReadFiles(PREVIEW_NONE)
    setupPublishers()
    await step8Publish.execute(makeCtx('/tmp/run_test'))
    const writeCall = mockWriteFile.mock.calls.find((c) => String(c[0]).includes('metadata.json'))!
    expect(String(writeCall[0])).toBe('/tmp/run_test/final/metadata.json')
  })
})

// ─── publishToPlatform ────────────────────────────────────────────────────────

describe('step8Publish — publishToPlatform', () => {
  it('appelé avec plateforme=tiktok', async () => {
    setupReadFiles(PREVIEW_NONE, { title: 'Test Title' })
    setupPublishers()
    await step8Publish.execute(makeCtx())
    expect(mockPublishToPlatform).toHaveBeenCalledOnce()
    const [platform] = mockPublishToPlatform.mock.calls[0]
    expect(platform).toBe('tiktok')
  })

  it('reçoit runId, title, hashtags, mediaMode corrects', async () => {
    setupReadFiles(PREVIEW_NONE, { title: 'Titre struct' })
    setupPublishers()
    await step8Publish.execute(makeCtx('/tmp/run_test'))
    const [, opts] = mockPublishToPlatform.mock.calls[0]
    expect(opts.runId).toBe('run_test')
    expect(opts.title).toBe('Titre struct')
    expect(opts.hashtags).toEqual(['#shorts', '#ai', '#filmcrew'])
    expect(opts.mediaMode).toBe('none')
  })
})

// ─── savePublishResult + upsertPublishManifest ────────────────────────────────

describe('step8Publish — persistance résultat', () => {
  it('savePublishResult appelé avec (runId, result)', async () => {
    setupReadFiles(PREVIEW_NONE)
    setupPublishers()
    await step8Publish.execute(makeCtx())
    expect(mockSavePublishResult).toHaveBeenCalledOnce()
    const [runId, result] = mockSavePublishResult.mock.calls[0]
    expect(runId).toBe('run_test')
    expect(result).toMatchObject({ platform: 'tiktok', status: 'NO_CREDENTIALS' })
  })

  it('upsertPublishManifest appelé avec (runId, result, { title, hashtags })', async () => {
    setupReadFiles(PREVIEW_NONE, { title: 'Titre upsert' })
    setupPublishers()
    await step8Publish.execute(makeCtx())
    expect(mockUpsertPublishManifest).toHaveBeenCalledOnce()
    const [runId, , opts] = mockUpsertPublishManifest.mock.calls[0]
    expect(runId).toBe('run_test')
    expect(opts.title).toBe('Titre upsert')
    expect(opts.hashtags).toEqual(['#shorts', '#ai', '#filmcrew'])
  })
})

// ─── outputData cohérent ──────────────────────────────────────────────────────

describe('step8Publish — outputData', () => {
  it('contient title, mode, hasPlayable, tiktokStatus, publishId, status, platforms', async () => {
    setupReadFiles(PREVIEW_NONE, { title: 'Mon titre' })
    mockPublishToPlatform.mockResolvedValue({ ...NO_CRED_RESULT, title: 'Mon titre' })
    mockSavePublishResult.mockResolvedValue(undefined)
    mockUpsertPublishManifest.mockResolvedValue(DUMMY_MANIFEST)
    const result = await step8Publish.execute(makeCtx())
    const data = result.outputData as Record<string, unknown>
    expect(data.title).toBe('Mon titre')
    expect(data.mode).toBe('none')
    expect(data.hasPlayable).toBe(false)
    expect(data.tiktokStatus).toBe('NO_CREDENTIALS')
    expect(data.publishId).toBeUndefined()
    expect(data.status).toBe('metadata_only')
    expect(Array.isArray(data.platforms)).toBe(true)
    expect((data.platforms as string[])).toContain('tiktok')
  })

  it('publishId présent dans outputData si result contient publishId', async () => {
    setupReadFiles(PREVIEW_WITH_VIDEO, { title: 'Vidéo pub' })
    mockPublishToPlatform.mockResolvedValue({
      ...NO_CRED_RESULT,
      status: 'SUCCESS',
      publishId: 'pub-123',
      mediaMode: 'video_finale',
    })
    mockSavePublishResult.mockResolvedValue(undefined)
    mockUpsertPublishManifest.mockResolvedValue(DUMMY_MANIFEST)
    const result = await step8Publish.execute(makeCtx())
    const data = result.outputData as Record<string, unknown>
    expect(data.publishId).toBe('pub-123')
    expect(data.tiktokStatus).toBe('SUCCESS')
  })

  it('success=true + costEur=0 dans tous les cas nominaux', async () => {
    setupReadFiles(PREVIEW_NONE)
    setupPublishers()
    const result = await step8Publish.execute(makeCtx())
    expect(result.success).toBe(true)
    expect(result.costEur).toBe(0)
  })
})
