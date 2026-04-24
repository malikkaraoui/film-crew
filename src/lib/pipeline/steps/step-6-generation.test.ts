import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'

// ─── Mocks déclarés avant tout import de module ───

vi.mock('@/lib/runs/project-config')
vi.mock('@/lib/audio/scene-assets')
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/db/connection', () => ({ db: { insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) } }))
vi.mock('@/lib/db/schema', () => ({ clip: 'clip' }))
vi.mock('@/lib/providers/failover')
vi.mock('@/lib/pipeline/provider-prompting', () => ({
  resolveProviderPrompt: (_map: unknown, _provider: unknown, prompt: string) => prompt,
}))
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { access, readFile } from 'fs/promises'
import { readProjectConfig } from '@/lib/runs/project-config'
import { resolveMusicFromStructure } from '@/lib/audio/scene-assets'
import { executeWithFailover } from '@/lib/providers/failover'
import { step6Generation } from './step-6-generation'
import type { StepContext } from '../types'

// ─── Helpers ───

function makeCtx(storagePath = '/tmp/run_test'): StepContext {
  return { runId: 'run_test', chainId: null, idea: 'test', brandKitPath: null, storagePath, intentionPath: null, template: null }
}

const mockAccess = access as MockedFunction<typeof access>
const mockReadFile = readFile as MockedFunction<typeof readFile>
const mockReadProjectConfig = readProjectConfig as MockedFunction<typeof readProjectConfig>
const mockResolveMusicFromStructure = resolveMusicFromStructure as MockedFunction<typeof resolveMusicFromStructure>
const mockExecuteWithFailover = executeWithFailover as MockedFunction<typeof executeWithFailover>

// ─── Setup helpers ───

function setupManualMode(audioManifest: object | null = null, musicPath: string | null = null) {
  mockReadProjectConfig.mockResolvedValue({ generationMode: 'manual' } as never)
  mockResolveMusicFromStructure.mockResolvedValue(musicPath)

  if (audioManifest) {
    mockReadFile.mockResolvedValue(JSON.stringify(audioManifest) as never)
    mockAccess.mockResolvedValue(undefined)
  } else {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Tests : source audio canonique ───

describe('step6Generation — source audio canonique', () => {
  it('audio-master-manifest.json présent → audioPath = masterFilePath', async () => {
    setupManualMode({ masterFilePath: '/tmp/run_test/audio/master.wav' })
    const result = await step6Generation.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).hasAudio).toBe(true)
  })

  it('audio-master-manifest.json absent → audioPath null, success=true (non bloquant)', async () => {
    setupManualMode(null)
    const result = await step6Generation.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).hasAudio).toBe(false)
  })

  it('manifest présent mais fichier disparu → audioPath null', async () => {
    mockReadProjectConfig.mockResolvedValue({ generationMode: 'manual' } as never)
    mockResolveMusicFromStructure.mockResolvedValue(null)
    // readFile retourne le manifest mais access échoue (fichier absent)
    mockReadFile.mockResolvedValue(JSON.stringify({ masterFilePath: '/tmp/disparu.wav' }) as never)
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    const result = await step6Generation.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).hasAudio).toBe(false)
  })

  it('aucun executeWithFailover TTS — audio toujours depuis le manifest', async () => {
    setupManualMode(null)
    await step6Generation.execute(makeCtx())
    // executeWithFailover ne doit jamais être appelé avec 'tts'
    const ttsCalls = (mockExecuteWithFailover.mock.calls as Array<[string, ...unknown[]]>)
      .filter(([type]) => type === 'tts')
    expect(ttsCalls).toHaveLength(0)
  })
})

// ─── Tests : source musique unifiée ───

describe('step6Generation — source musique unifiée', () => {
  it('resolveMusicFromStructure appelé exactement une fois', async () => {
    setupManualMode(null, '/assets/music/tension.wav')
    await step6Generation.execute(makeCtx())
    expect(mockResolveMusicFromStructure).toHaveBeenCalledOnce()
    expect(mockResolveMusicFromStructure).toHaveBeenCalledWith('/tmp/run_test')
  })

  it('musicPath résolu → présent dans generation-manifest.json', async () => {
    setupManualMode(null, '/assets/music/calm.wav')
    await step6Generation.execute(makeCtx())
    // writeFile appelé avec le manifest contenant musicPath
    const { writeFile } = await import('fs/promises')
    const writeFileMock = writeFile as MockedFunction<typeof writeFile>
    const [, content] = writeFileMock.mock.calls[0]
    const manifest = JSON.parse(content as string)
    expect(manifest.musicPath).toBe('/assets/music/calm.wav')
  })

  it('musicPath null si resolveMusicFromStructure retourne null', async () => {
    setupManualMode(null, null)
    await step6Generation.execute(makeCtx())
    const { writeFile } = await import('fs/promises')
    const writeFileMock = writeFile as MockedFunction<typeof writeFile>
    const [, content] = writeFileMock.mock.calls[0]
    const manifest = JSON.parse(content as string)
    expect(manifest.musicPath).toBeNull()
  })
})

// ─── Tests : mode manuel ───

describe('step6Generation — mode manuel', () => {
  it('mode manuel → success=true, autoGenerationSkipped=true', async () => {
    setupManualMode()
    const result = await step6Generation.execute(makeCtx())
    expect(result.success).toBe(true)
    expect((result.outputData as Record<string, unknown>).autoGenerationSkipped).toBe(true)
  })

  it('mode manuel → aucun appel executeWithFailover', async () => {
    setupManualMode()
    await step6Generation.execute(makeCtx())
    expect(mockExecuteWithFailover).not.toHaveBeenCalled()
  })
})
