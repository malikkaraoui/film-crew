import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'fs/promises'
import { tmpdir } from 'os'
import type { DialogueScript } from '@/types/audio'

// Mock providers + DB
vi.mock('@/lib/providers/failover', () => ({
  executeWithFailover: vi.fn(),
}))

vi.mock('@/lib/db/queries/audio-assets', () => ({
  upsertAudioAsset: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('buildAudioPreview', () => {
  let storagePath: string

  const sampleScript: DialogueScript = {
    runId: 'test-run',
    language: 'fr',
    totalDurationTargetS: 20,
    scenes: [
      {
        sceneIndex: 1,
        title: 'Scène 1',
        durationTargetS: 10,
        lines: [
          { lineIndex: 0, speaker: 'narrateur', text: 'Bonjour le monde', tone: 'neutre', pace: 'normal', emphasis: ['monde'], estimatedDurationS: 2 },
          { lineIndex: 1, speaker: 'narrateur', text: 'Ceci est un test', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 2 },
        ],
        silences: [
          { afterLineIndex: 0, durationS: 0.5, purpose: 'respiration' },
        ],
        stageDirections: 'Calme',
      },
      {
        sceneIndex: 2,
        title: 'Scène 2',
        durationTargetS: 10,
        lines: [
          { lineIndex: 0, speaker: 'personnage_A', text: 'Dernière réplique', tone: 'grave', pace: 'slow', emphasis: [], estimatedDurationS: 3 },
        ],
        silences: [],
        stageDirections: 'Solennel',
      },
    ],
  }

  function createMinimalWav(durationS: number): Buffer {
    const sampleRate = 24000
    const dataSize = Math.floor(sampleRate * durationS) * 2
    const buf = Buffer.alloc(44 + dataSize)
    buf.write('RIFF', 0)
    buf.writeUInt32LE(36 + dataSize, 4)
    buf.write('WAVE', 8)
    buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(1, 22)
    buf.writeUInt32LE(sampleRate, 24)
    buf.writeUInt32LE(sampleRate * 2, 28)
    buf.writeUInt16LE(2, 32)
    buf.writeUInt16LE(16, 34)
    buf.write('data', 36)
    buf.writeUInt32LE(dataSize, 40)
    return buf
  }

  beforeEach(async () => {
    storagePath = await mkdtemp(join(tmpdir(), 'audio-manifest-'))
  })

  afterEach(async () => {
    await rm(storagePath, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('retourne null si dialogue_script.json est absent', async () => {
    const { buildAudioPreview } = await import('../audio-manifest')
    const result = await buildAudioPreview({ storagePath, runId: 'r1' })
    expect(result).toBeNull()
  })

  it('orchestre TTS + assemblage + manifest complet', async () => {
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))

    const { executeWithFailover } = await import('@/lib/providers/failover')
    let callCount = 0
    vi.mocked(executeWithFailover).mockImplementation(async () => {
      callCount++
      const ttsDir = join(storagePath, 'tts')
      await mkdir(ttsDir, { recursive: true })
      const fp = join(ttsDir, `tts-kokoro-${Date.now()}-${callCount}.wav`)
      await writeFile(fp, createMinimalWav(2.0))
      return {
        result: { filePath: fp, duration: 2.0, costEur: 0 },
        provider: { name: 'kokoro-local', type: 'tts' },
      } as never
    })

    const { buildAudioPreview } = await import('../audio-manifest')
    const result = await buildAudioPreview({ storagePath, runId: 'test-run' })

    expect(result).not.toBeNull()

    // Manifest écrit sur disque
    const manifestRaw = await readFile(join(storagePath, 'audio_preview_manifest.json'), 'utf-8')
    const manifest = JSON.parse(manifestRaw)
    expect(manifest.runId).toBe('test-run')
    expect(manifest.durationS).toBeGreaterThan(0)
    expect(manifest.ttsProvider).toBe('kokoro-local')
    expect(manifest.timeline.segments.length).toBeGreaterThan(0)
    expect(manifest.musicSources).toEqual([])
    expect(manifest.fxSources).toEqual([])

    // audio_preview.wav existe
    await expect(access(result!.audioPreviewPath)).resolves.not.toThrow()

    // DB persist appelé
    const { upsertAudioAsset } = await import('@/lib/db/queries/audio-assets')
    expect(upsertAudioAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'test-run',
        type: 'audio_preview',
        status: 'assembled',
      }),
    )
  }, 15000)

  // ─── Stale artifacts regression ───

  it('nettoie stale manifest si script absent (TTS échoue)', async () => {
    // Pré-créer un stale manifest
    await writeFile(join(storagePath, 'audio_preview_manifest.json'), JSON.stringify({ stale: true }))

    const { buildAudioPreview } = await import('../audio-manifest')
    const result = await buildAudioPreview({ storagePath, runId: 'r1' })

    expect(result).toBeNull()
    await expect(access(join(storagePath, 'audio_preview_manifest.json'))).rejects.toThrow()
  })

  it('nettoie stale manifest si assemblage échoue', async () => {
    // Script avec une ligne mais TTS va réussir, assemblage va échouer (pas de WAV valides)
    const scriptOneLine: DialogueScript = {
      ...sampleScript,
      scenes: [{
        ...sampleScript.scenes[0],
        lines: [sampleScript.scenes[0].lines[0]],
      }],
    }
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(scriptOneLine))
    await writeFile(join(storagePath, 'audio_preview_manifest.json'), JSON.stringify({ stale: true }))

    const { executeWithFailover } = await import('@/lib/providers/failover')
    // TTS réussit mais produit un fichier WAV vide/invalide → assemblage ffmpeg échouera
    vi.mocked(executeWithFailover).mockImplementation(async () => {
      const ttsDir = join(storagePath, 'tts')
      await mkdir(ttsDir, { recursive: true })
      const fp = join(ttsDir, `tts-kokoro-${Date.now()}.wav`)
      // WAV invalide (trop petit pour ffmpeg)
      await writeFile(fp, Buffer.from('not-a-wav'))
      return {
        result: { filePath: fp, duration: 1.0, costEur: 0 },
        provider: { name: 'kokoro-local', type: 'tts' },
      } as never
    })

    const { buildAudioPreview } = await import('../audio-manifest')
    const result = await buildAudioPreview({ storagePath, runId: 'test-run' })

    expect(result).toBeNull()
    await expect(access(join(storagePath, 'audio_preview_manifest.json'))).rejects.toThrow()
  }, 15000)

  it('rerun nettoie puis recrée proprement le manifest', async () => {
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))

    const { executeWithFailover } = await import('@/lib/providers/failover')
    vi.mocked(executeWithFailover).mockImplementation(async () => {
      const ttsDir = join(storagePath, 'tts')
      await mkdir(ttsDir, { recursive: true })
      const fp = join(ttsDir, `tts-kokoro-${Date.now()}.wav`)
      await writeFile(fp, createMinimalWav(1.5))
      return {
        result: { filePath: fp, duration: 1.5, costEur: 0 },
        provider: { name: 'kokoro-local', type: 'tts' },
      } as never
    })

    const { buildAudioPreview } = await import('../audio-manifest')

    // Premier run
    const result1 = await buildAudioPreview({ storagePath, runId: 'test-run' })
    expect(result1).not.toBeNull()
    const manifest1Raw = await readFile(join(storagePath, 'audio_preview_manifest.json'), 'utf-8')
    const manifest1 = JSON.parse(manifest1Raw)

    // Deuxième run — le manifest doit être recréé (pas l'ancien)
    const result2 = await buildAudioPreview({ storagePath, runId: 'test-run' })
    expect(result2).not.toBeNull()
    const manifest2Raw = await readFile(join(storagePath, 'audio_preview_manifest.json'), 'utf-8')
    const manifest2 = JSON.parse(manifest2Raw)

    // Le generatedAt doit être différent (rerun)
    expect(manifest2.generatedAt).not.toBe(manifest1.generatedAt)
  }, 15000)

  it('continue même si DB persist échoue', async () => {
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))

    const { executeWithFailover } = await import('@/lib/providers/failover')
    vi.mocked(executeWithFailover).mockImplementation(async () => {
      const ttsDir = join(storagePath, 'tts')
      await mkdir(ttsDir, { recursive: true })
      const fp = join(ttsDir, `tts-kokoro-${Date.now()}.wav`)
      await writeFile(fp, createMinimalWav(1.5))
      return {
        result: { filePath: fp, duration: 1.5, costEur: 0 },
        provider: { name: 'kokoro-local', type: 'tts' },
      } as never
    })

    // Simuler une erreur DB
    const { upsertAudioAsset } = await import('@/lib/db/queries/audio-assets')
    vi.mocked(upsertAudioAsset).mockRejectedValue(new Error('DB connection refused'))

    const { buildAudioPreview } = await import('../audio-manifest')
    const result = await buildAudioPreview({ storagePath, runId: 'test-run' })

    // Le résultat doit quand même être retourné
    expect(result).not.toBeNull()
    expect(result!.manifest.durationS).toBeGreaterThan(0)
  }, 15000)
})
