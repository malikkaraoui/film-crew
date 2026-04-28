import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSceneMixCommand, mixScene, DEFAULT_MIX_VOLUMES } from './mix-scene'
import type { SceneMixConfig } from './mix-scene'
import { EventEmitter } from 'events'

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

  // Schedule events asynchronously so listeners can attach first
  queueMicrotask(() => {
    if (stderrData) {
      proc.stderr.emit('data', Buffer.from(stderrData))
    }
    proc.emit('close', exitCode)
  })

  return proc
}

// ─── Helpers ───

function baseConfig(overrides: Partial<SceneMixConfig> = {}): SceneMixConfig {
  return {
    ttsPath: '/tmp/tts.wav',
    ambiancePath: null,
    fxPaths: [],
    musicPath: null,
    outputPath: '/tmp/out.wav',
    volumes: { ...DEFAULT_MIX_VOLUMES },
    targetDurationS: 30,
    ...overrides,
  }
}

// ─── Tests ───

describe('buildSceneMixCommand', () => {
  it('dialogue only — simple copy, no filter_complex or amix', () => {
    const cmd = buildSceneMixCommand(baseConfig())

    expect(cmd.args).toContain('-i')
    expect(cmd.args).toContain('/tmp/tts.wav')
    expect(cmd.args).toContain('-y')
    expect(cmd.args).toContain('/tmp/out.wav')
    expect(cmd.args).toContain('-af')
    expect(cmd.args.join(' ')).toContain('apad=whole_dur=30')
    expect(cmd.args).not.toContain('-filter_complex')
    expect(cmd.args.join(' ')).not.toContain('amix')
  })

  it('dialogue + ambiance + music — 3 inputs with aloop and amix=inputs=3', () => {
    const cmd = buildSceneMixCommand(
      baseConfig({
        ambiancePath: '/tmp/ambiance.wav',
        musicPath: '/tmp/music.wav',
      }),
    )

    const args = cmd.args
    const inputCount = args.filter((a) => a === '-i').length
    expect(inputCount).toBe(3)

    const fcIndex = args.indexOf('-filter_complex')
    expect(fcIndex).toBeGreaterThan(-1)

    const filterComplex = args[fcIndex + 1]
    expect(filterComplex).toContain('amix=inputs=3')
    expect(filterComplex).toContain('duration=longest')
    expect(filterComplex).toContain('apad=whole_dur=30')

    // Ambiance and music should be looped
    const aloopOccurrences = (filterComplex.match(/aloop/g) || []).length
    expect(aloopOccurrences).toBe(2)

    // Verify volumes appear in the filter
    expect(filterComplex).toContain(`volume=${DEFAULT_MIX_VOLUMES.dialogue}`)
    expect(filterComplex).toContain(`volume=${DEFAULT_MIX_VOLUMES.ambiance}`)
    expect(filterComplex).toContain(`volume=${DEFAULT_MIX_VOLUMES.music}`)
  })

  it('dialogue + FX only — no aloop, amix=inputs matches', () => {
    const cmd = buildSceneMixCommand(
      baseConfig({
        fxPaths: ['/tmp/fx1.wav', '/tmp/fx2.wav'],
      }),
    )

    const args = cmd.args
    const inputCount = args.filter((a) => a === '-i').length
    expect(inputCount).toBe(3) // tts + 2 fx

    const fcIndex = args.indexOf('-filter_complex')
    const filterComplex = args[fcIndex + 1]
    expect(filterComplex).toContain('amix=inputs=3')
    expect(filterComplex).toContain('duration=longest')
    expect(filterComplex).not.toContain('aloop')
  })

  it('dialogue + ambiance + FX + music (all layers) — amix=inputs=N correct', () => {
    const cmd = buildSceneMixCommand(
      baseConfig({
        ambiancePath: '/tmp/ambiance.wav',
        fxPaths: ['/tmp/fx1.wav'],
        musicPath: '/tmp/music.wav',
      }),
    )

    const args = cmd.args
    const inputCount = args.filter((a) => a === '-i').length
    expect(inputCount).toBe(4) // tts + ambiance + fx + music

    const fcIndex = args.indexOf('-filter_complex')
    const filterComplex = args[fcIndex + 1]
    expect(filterComplex).toContain('amix=inputs=4')
    expect(filterComplex).toContain('duration=longest')

    // 2 aloop (ambiance + music), not fx
    const aloopOccurrences = (filterComplex.match(/aloop/g) || []).length
    expect(aloopOccurrences).toBe(2)
  })
})

describe('mixScene', () => {
  beforeEach(() => {
    mockSpawn.mockReset()
  })

  it('resolves when spawn exits with code 0', async () => {
    mockSpawn.mockReturnValue(createMockProcess(0) as any)
    await expect(mixScene(baseConfig())).resolves.toBeUndefined()
  })

  it('rejects with stderr when spawn exits with non-zero code', async () => {
    mockSpawn.mockReturnValue(createMockProcess(1, 'encoder error') as any)
    await expect(mixScene(baseConfig())).rejects.toThrow('encoder error')
  })
})
