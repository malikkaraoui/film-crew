import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('@/lib/db/queries/traces', () => ({
  deleteAgentTraces: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db/queries/runs', () => ({
  deleteClipsForRun: vi.fn().mockResolvedValue(undefined),
  resetRunStepsFromStep: vi.fn().mockResolvedValue(undefined),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
}))

describe('resetRunFromStep', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('supprime dialogue_script.json lors d’un reset depuis le step 3', async () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'filmcrew-reset-'))
    tempDirs.push(storagePath)

    mkdirSync(join(storagePath, 'clips'), { recursive: true })
    mkdirSync(join(storagePath, 'audio'), { recursive: true })
    mkdirSync(join(storagePath, 'subtitles'), { recursive: true })
    mkdirSync(join(storagePath, 'storyboard'), { recursive: true })
    mkdirSync(join(storagePath, 'final'), { recursive: true })

    writeFileSync(join(storagePath, 'structure.json'), '{}')
    writeFileSync(join(storagePath, 'structure-raw.txt'), 'raw')
    writeFileSync(join(storagePath, 'director-plan.json'), '{}')
    writeFileSync(join(storagePath, 'dialogue_script.json'), '{}')

    const { resetRunFromStep } = await import('../reset')

    await resetRunFromStep({
      runId: 'run-reset-test',
      storagePath,
      stepNumber: 3,
    })

    expect(existsSync(join(storagePath, 'dialogue_script.json'))).toBe(false)
    expect(existsSync(join(storagePath, 'clips'))).toBe(true)
    expect(existsSync(join(storagePath, 'audio'))).toBe(true)
    expect(existsSync(join(storagePath, 'subtitles'))).toBe(true)
  })

  it('préserve l’audio master lors d’un reset depuis le step 7 (Prompts)', async () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'filmcrew-reset-'))
    tempDirs.push(storagePath)

    mkdirSync(join(storagePath, 'audio', 'scenes'), { recursive: true })
    mkdirSync(join(storagePath, 'clips'), { recursive: true })
    mkdirSync(join(storagePath, 'storyboard'), { recursive: true })
    mkdirSync(join(storagePath, 'final'), { recursive: true })
    mkdirSync(join(storagePath, 'subtitles'), { recursive: true })

    writeFileSync(join(storagePath, 'audio', 'audio-master-manifest.json'), '{}')
    writeFileSync(join(storagePath, 'audio', 'master.wav'), 'master')
    writeFileSync(join(storagePath, 'prompts.json'), '{}')
    writeFileSync(join(storagePath, 'prompt-manifest.json'), '{}')
    writeFileSync(join(storagePath, 'generation-manifest.json'), '{}')

    const { resetRunFromStep } = await import('../reset')

    await resetRunFromStep({
      runId: 'run-reset-test',
      storagePath,
      stepNumber: 7,
    })

    expect(existsSync(join(storagePath, 'audio', 'audio-master-manifest.json'))).toBe(true)
    expect(existsSync(join(storagePath, 'audio', 'master.wav'))).toBe(true)
    expect(existsSync(join(storagePath, 'prompts.json'))).toBe(false)
    expect(existsSync(join(storagePath, 'prompt-manifest.json'))).toBe(false)
    expect(existsSync(join(storagePath, 'generation-manifest.json'))).toBe(false)
  })

  it('supprime les artefacts audio lors d’un reset depuis le step 6 (Audio Package)', async () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'filmcrew-reset-'))
    tempDirs.push(storagePath)

    mkdirSync(join(storagePath, 'audio', 'scenes'), { recursive: true })
    mkdirSync(join(storagePath, 'storyboard'), { recursive: true })
    mkdirSync(join(storagePath, 'final'), { recursive: true })
    mkdirSync(join(storagePath, 'subtitles'), { recursive: true })

    writeFileSync(join(storagePath, 'audio', 'audio-master-manifest.json'), '{}')
    writeFileSync(join(storagePath, 'audio', 'master.wav'), 'master')
    writeFileSync(join(storagePath, 'audio', 'scenes', '0.wav'), 'scene')

    const { resetRunFromStep } = await import('../reset')

    await resetRunFromStep({
      runId: 'run-reset-test',
      storagePath,
      stepNumber: 6,
    })

    expect(existsSync(join(storagePath, 'audio', 'audio-master-manifest.json'))).toBe(false)
    expect(existsSync(join(storagePath, 'audio', 'master.wav'))).toBe(false)
    expect(existsSync(join(storagePath, 'audio', 'scenes'))).toBe(false)
  })
})
