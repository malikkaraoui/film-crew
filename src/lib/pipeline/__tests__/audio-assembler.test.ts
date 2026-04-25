import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'fs/promises'
import { tmpdir } from 'os'
import type { DialogueScript } from '@/types/audio'
import type { TTSManifest } from '../tts-renderer'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('assembleDialogueAudio', () => {
  let storagePath: string

  const sampleManifest: TTSManifest = {
    runId: 'test-run',
    provider: 'kokoro-local',
    voice: 'default',
    language: 'fr',
    lines: [
      { sceneIndex: 1, lineIndex: 0, speaker: 'narrateur', filePath: 'tts-scene1-line0.wav', durationS: 2.5 },
      { sceneIndex: 1, lineIndex: 1, speaker: 'narrateur', filePath: 'tts-scene1-line1.wav', durationS: 3.0 },
      { sceneIndex: 2, lineIndex: 0, speaker: 'personnage_A', filePath: 'tts-scene2-line0.wav', durationS: 2.0 },
    ],
  }

  const sampleScript: DialogueScript = {
    runId: 'test-run',
    language: 'fr',
    totalDurationTargetS: 30,
    scenes: [
      {
        sceneIndex: 1,
        title: 'Scène 1',
        durationTargetS: 15,
        lines: [
          { lineIndex: 0, speaker: 'narrateur', text: 'Bonjour', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 2.5 },
          { lineIndex: 1, speaker: 'narrateur', text: 'Suite', tone: 'grave', pace: 'slow', emphasis: ['Suite'], estimatedDurationS: 3.0 },
        ],
        silences: [
          { afterLineIndex: 0, durationS: 1.0, purpose: 'respiration' },
        ],
        stageDirections: 'Ton calme',
      },
      {
        sceneIndex: 2,
        title: 'Scène 2',
        durationTargetS: 15,
        lines: [
          { lineIndex: 0, speaker: 'personnage_A', text: 'Fin', tone: 'grave', pace: 'slow', emphasis: [], estimatedDurationS: 2.0 },
        ],
        silences: [],
        stageDirections: 'Solennel',
      },
    ],
  }

  /**
   * Crée un WAV PCM minimal valide (silence).
   * 24000Hz, mono, 16bit, durée donnée.
   */
  function createMinimalWav(durationS: number): Buffer {
    const sampleRate = 24000
    const numChannels = 1
    const bitsPerSample = 16
    const numSamples = Math.floor(sampleRate * durationS)
    const dataSize = numSamples * numChannels * (bitsPerSample / 8)
    const buf = Buffer.alloc(44 + dataSize)

    buf.write('RIFF', 0)
    buf.writeUInt32LE(36 + dataSize, 4)
    buf.write('WAVE', 8)
    buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)  // PCM
    buf.writeUInt16LE(numChannels, 22)
    buf.writeUInt32LE(sampleRate, 24)
    buf.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28)
    buf.writeUInt16LE(numChannels * bitsPerSample / 8, 32)
    buf.writeUInt16LE(bitsPerSample, 34)
    buf.write('data', 36)
    buf.writeUInt32LE(dataSize, 40)

    return buf
  }

  async function setupTTSFiles(): Promise<void> {
    const ttsDir = join(storagePath, 'tts')
    await mkdir(ttsDir, { recursive: true })

    // Créer de vrais WAV minimaux pour chaque ligne
    for (const line of sampleManifest.lines) {
      await writeFile(join(ttsDir, line.filePath), createMinimalWav(line.durationS))
    }
  }

  beforeEach(async () => {
    storagePath = await mkdtemp(join(tmpdir(), 'audio-asm-'))
  })

  afterEach(async () => {
    await rm(storagePath, { recursive: true, force: true })
  })

  it('retourne null si tts_manifest.json est absent', async () => {
    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'r1' })
    expect(result).toBeNull()
  })

  it('retourne null si le manifest a 0 lignes', async () => {
    const emptyManifest: TTSManifest = { ...sampleManifest, lines: [] }
    await writeFile(join(storagePath, 'tts_manifest.json'), JSON.stringify(emptyManifest))

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'r1' })
    expect(result).toBeNull()
  })

  it('assemble les WAV + silences et produit audio_preview.wav + audio_timeline.json', async () => {
    await writeFile(join(storagePath, 'tts_manifest.json'), JSON.stringify(sampleManifest))
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))
    await setupTTSFiles()

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'test-run' })

    expect(result).not.toBeNull()

    // audio_preview.wav existe
    await expect(access(result!.audioPreviewPath)).resolves.not.toThrow()

    // audio_timeline.json existe sur disque
    const timelineRaw = await readFile(join(storagePath, 'audio_timeline.json'), 'utf-8')
    const timeline = JSON.parse(timelineRaw)
    expect(timeline.runId).toBe('test-run')
    expect(timeline.segments.length).toBeGreaterThan(0)

    // Vérifier les types de segments
    const types = result!.timeline.segments.map((s) => s.type)
    expect(types).toContain('dialogue')

    // totalDurationS > 0
    expect(result!.totalDurationS).toBeGreaterThan(0)
  }, 15000) // ffmpeg peut être lent

  it('insère des silences depuis le dialogue_script', async () => {
    await writeFile(join(storagePath, 'tts_manifest.json'), JSON.stringify(sampleManifest))
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))
    await setupTTSFiles()

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'test-run' })

    expect(result).not.toBeNull()

    // Il doit y avoir au moins un segment silence (afterLineIndex 0, scène 1)
    const silences = result!.timeline.segments.filter((s) => s.type === 'silence')
    expect(silences.length).toBeGreaterThanOrEqual(1)
    expect(silences[0].durationS).toBeCloseTo(1.0, 1)
    expect(silences[0].content.silenceMarker?.purpose).toBe('respiration')
  }, 15000)

  it('insère un silence inter-scènes entre scènes différentes', async () => {
    await writeFile(join(storagePath, 'tts_manifest.json'), JSON.stringify(sampleManifest))
    await setupTTSFiles()

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'test-run' })

    expect(result).not.toBeNull()

    // Silence inter-scènes entre scène 1 et scène 2
    const transitions = result!.timeline.segments.filter((s) => s.type === 'transition')
    expect(transitions.length).toBe(1)
    expect(transitions[0].durationS).toBeCloseTo(0.2, 2) // 200ms par défaut
    expect(transitions[0].videoPromptHint).toContain('silence inter-scènes')
  }, 15000)

  it('fonctionne sans dialogue_script.json (pas de silences)', async () => {
    await writeFile(join(storagePath, 'tts_manifest.json'), JSON.stringify(sampleManifest))
    await setupTTSFiles()

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'test-run' })

    expect(result).not.toBeNull()

    // Uniquement dialogue + transitions, pas de silence
    const silences = result!.timeline.segments.filter((s) => s.type === 'silence')
    expect(silences.length).toBe(0)
  }, 15000)

  // ─── Stale artifacts regression ───

  it('nettoie les stale artifacts quand manifest est absent', async () => {
    // Pré-créer des stale artifacts
    await mkdir(join(storagePath, 'audio'), { recursive: true })
    await writeFile(join(storagePath, 'audio', 'audio_preview.wav'), Buffer.from('stale'))
    await writeFile(join(storagePath, 'audio_timeline.json'), JSON.stringify({ stale: true }))

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'r1' })

    expect(result).toBeNull()
    // Les stale artifacts doivent avoir été supprimés
    await expect(access(join(storagePath, 'audio', 'audio_preview.wav'))).rejects.toThrow()
    await expect(access(join(storagePath, 'audio_timeline.json'))).rejects.toThrow()
  })

  it('nettoie les stale artifacts quand manifest est vide', async () => {
    const emptyManifest: TTSManifest = { ...sampleManifest, lines: [] }
    await writeFile(join(storagePath, 'tts_manifest.json'), JSON.stringify(emptyManifest))

    // Pré-créer des stale artifacts
    await mkdir(join(storagePath, 'audio'), { recursive: true })
    await writeFile(join(storagePath, 'audio', 'audio_preview.wav'), Buffer.from('stale'))
    await writeFile(join(storagePath, 'audio_timeline.json'), JSON.stringify({ stale: true }))

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'r1' })

    expect(result).toBeNull()
    await expect(access(join(storagePath, 'audio', 'audio_preview.wav'))).rejects.toThrow()
    await expect(access(join(storagePath, 'audio_timeline.json'))).rejects.toThrow()
  })

  it('nettoie les stale artifacts au rerun (avant assemblage)', async () => {
    // Premier run : assemblage réussi
    await writeFile(join(storagePath, 'tts_manifest.json'), JSON.stringify(sampleManifest))
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))
    await setupTTSFiles()

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result1 = await assembleDialogueAudio({ storagePath, runId: 'test-run' })
    expect(result1).not.toBeNull()

    // Vérifier que les artifacts existent
    await expect(access(join(storagePath, 'audio', 'audio_preview.wav'))).resolves.not.toThrow()
    await expect(access(join(storagePath, 'audio_timeline.json'))).resolves.not.toThrow()

    // Deuxième run : les anciens artifacts sont nettoyés puis recréés
    const result2 = await assembleDialogueAudio({ storagePath, runId: 'test-run' })
    expect(result2).not.toBeNull()
    expect(result2!.totalDurationS).toBeGreaterThan(0)
  }, 15000)

  it('les segments ont des timestamps continus croissants', async () => {
    await writeFile(join(storagePath, 'tts_manifest.json'), JSON.stringify(sampleManifest))
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))
    await setupTTSFiles()

    const { assembleDialogueAudio } = await import('../audio-assembler')
    const result = await assembleDialogueAudio({ storagePath, runId: 'test-run' })

    expect(result).not.toBeNull()

    const segments = result!.timeline.segments
    for (let i = 1; i < segments.length; i++) {
      // Le startS de chaque segment doit être >= endS du précédent (continuité)
      expect(segments[i].startS).toBeCloseTo(segments[i - 1].endS, 2)
    }

    // Le dernier segment endS doit correspondre au totalDurationS
    const lastSegment = segments[segments.length - 1]
    expect(lastSegment.endS).toBeCloseTo(result!.totalDurationS, 2)
  }, 15000)
})
