import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { computeTimeline, assembleMaster } from './mix-master'
import type { SceneMixInput } from './mix-master'

// ─── Mock fs/promises ───

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { mkdir, copyFile, writeFile } from 'fs/promises'
const mockMkdir = vi.mocked(mkdir)
const mockCopyFile = vi.mocked(copyFile)
const mockWriteFile = vi.mocked(writeFile)

// ─── Mock child_process.spawn ───

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

import { spawn } from 'child_process'
const mockSpawn = vi.mocked(spawn)

function createMockProcess(exitCode: number, stderrData = '') {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter
    stdout: EventEmitter
    stderr: EventEmitter
  }
  proc.stdin = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()

  queueMicrotask(() => {
    if (stderrData) {
      proc.stderr.emit('data', Buffer.from(stderrData))
    }
    proc.emit('close', exitCode)
  })

  return proc
}

// ─── Helpers ───

function makeScene(overrides: Partial<SceneMixInput> & { sceneIndex: number; durationS: number }): SceneMixInput {
  return {
    ttsFilePath: `/tmp/scene${overrides.sceneIndex}/tts.wav`,
    mixFilePath: `/tmp/scene${overrides.sceneIndex}/mix.wav`,
    ttsProvider: 'elevenlabs',
    costEur: 0.05,
    ...overrides,
  }
}

// ─── Tests ───

beforeEach(() => {
  vi.clearAllMocks()
})

describe('computeTimeline', () => {
  it('3 scènes consécutives — offsets cumulés corrects', () => {
    const scenes: SceneMixInput[] = [
      makeScene({ sceneIndex: 0, durationS: 5 }),
      makeScene({ sceneIndex: 1, durationS: 8 }),
      makeScene({ sceneIndex: 2, durationS: 3 }),
    ]

    const timeline = computeTimeline(scenes)

    expect(timeline).toHaveLength(3)

    expect(timeline[0].startS).toBe(0)
    expect(timeline[0].endS).toBe(5)
    expect(timeline[0].durationS).toBe(5)
    expect(timeline[0].status).toBe('assembled')

    expect(timeline[1].startS).toBe(5)
    expect(timeline[1].endS).toBe(13)
    expect(timeline[1].durationS).toBe(8)
    expect(timeline[1].status).toBe('assembled')

    expect(timeline[2].startS).toBe(13)
    expect(timeline[2].endS).toBe(16)
    expect(timeline[2].durationS).toBe(3)
    expect(timeline[2].status).toBe('assembled')
  })

  it('1 scène — startS=0, endS=durationS', () => {
    const scenes: SceneMixInput[] = [
      makeScene({ sceneIndex: 0, durationS: 12.5 }),
    ]

    const timeline = computeTimeline(scenes)

    expect(timeline).toHaveLength(1)
    expect(timeline[0].startS).toBe(0)
    expect(timeline[0].endS).toBe(12.5)
    expect(timeline[0].durationS).toBe(12.5)
    expect(timeline[0].status).toBe('assembled')
  })

  it('scènes non triées — résultat trié par sceneIndex', () => {
    const scenes: SceneMixInput[] = [
      makeScene({ sceneIndex: 2, durationS: 4 }),
      makeScene({ sceneIndex: 0, durationS: 6 }),
      makeScene({ sceneIndex: 1, durationS: 3 }),
    ]

    const timeline = computeTimeline(scenes)

    expect(timeline[0].sceneIndex).toBe(0)
    expect(timeline[1].sceneIndex).toBe(1)
    expect(timeline[2].sceneIndex).toBe(2)

    expect(timeline[0].startS).toBe(0)
    expect(timeline[0].endS).toBe(6)
    expect(timeline[1].startS).toBe(6)
    expect(timeline[1].endS).toBe(9)
    expect(timeline[2].startS).toBe(9)
    expect(timeline[2].endS).toBe(13)
  })
})

describe('assembleMaster', () => {
  it('0 scènes — throw', async () => {
    await expect(
      assembleMaster({ scenes: [], outputDir: '/tmp/out', runId: 'run-1' }),
    ).rejects.toThrow('Aucune scène')
  })

  it('1 scène — copyFile, pas de spawn', async () => {
    const scenes: SceneMixInput[] = [
      makeScene({ sceneIndex: 0, durationS: 10, costEur: 0.12 }),
    ]

    const manifest = await assembleMaster({
      scenes,
      outputDir: '/tmp/out',
      runId: 'run-single',
    })

    expect(mockCopyFile).toHaveBeenCalledOnce()
    expect(mockCopyFile).toHaveBeenCalledWith(
      '/tmp/scene0/mix.wav',
      '/tmp/out/master.wav',
    )
    expect(mockSpawn).not.toHaveBeenCalled()
    expect(mockMkdir).toHaveBeenCalledWith('/tmp/out', { recursive: true })

    // Vérifie le manifest
    expect(manifest.version).toBe('1.0')
    expect(manifest.runId).toBe('run-single')
    expect(manifest.totalDurationS).toBe(10)
    expect(manifest.sampleRate).toBe(44100)
    expect(manifest.channels).toBe(2)
    expect(manifest.masterFilePath).toBe('/tmp/out/master.wav')
    expect(manifest.scenes).toHaveLength(1)
    expect(manifest.qualityChecks.allScenesRendered).toBe(true)
    expect(manifest.qualityChecks.totalCostEur).toBe(0.12)
  })

  it('N scènes — spawn FFmpeg + manifest écrit', async () => {
    mockSpawn.mockImplementation(() => createMockProcess(0) as ReturnType<typeof spawn>)

    const scenes: SceneMixInput[] = [
      makeScene({ sceneIndex: 0, durationS: 5, costEur: 0.10 }),
      makeScene({ sceneIndex: 1, durationS: 8, costEur: 0.15 }),
      makeScene({ sceneIndex: 2, durationS: 3, costEur: 0.05 }),
    ]

    const manifest = await assembleMaster({
      scenes,
      outputDir: '/tmp/master-out',
      runId: 'run-multi',
    })

    // FFmpeg appelé
    expect(mockSpawn).toHaveBeenCalledOnce()
    const spawnArgs = mockSpawn.mock.calls[0]
    expect(spawnArgs[0]).toBe('ffmpeg')

    const args = spawnArgs[1] as string[]
    expect(args).toContain('-filter_complex')
    expect(args).toContain('-y')
    expect(args).toContain('/tmp/master-out/master.wav')

    // Pas de copyFile pour N scènes
    expect(mockCopyFile).not.toHaveBeenCalled()

    // Manifest écrit
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const writeArgs = mockWriteFile.mock.calls[0]
    expect(writeArgs[0]).toBe('/tmp/master-out/audio-master-manifest.json')

    const writtenManifest = JSON.parse(writeArgs[1] as string)
    expect(writtenManifest.version).toBe('1.0')
    expect(writtenManifest.runId).toBe('run-multi')
    expect(writtenManifest.totalDurationS).toBe(16)
    expect(writtenManifest.scenes).toHaveLength(3)
    expect(writtenManifest.qualityChecks.totalCostEur).toBeCloseTo(0.30)

    // Retour
    expect(manifest.version).toBe('1.0')
    expect(manifest.runId).toBe('run-multi')
    expect(manifest.totalDurationS).toBe(16)
    expect(manifest.masterFilePath).toBe('/tmp/master-out/master.wav')
    expect(manifest.generatedAt).toBeTruthy()
  })
})
