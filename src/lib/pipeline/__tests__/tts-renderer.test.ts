import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import type { DialogueScript } from '@/types/audio'

// Mock du failover pour éviter de toucher aux vrais providers
vi.mock('@/lib/providers/failover', () => ({
  executeWithFailover: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('renderDialogueToTTS', () => {
  let storagePath: string

  const sampleScript: DialogueScript = {
    runId: 'test-run-1',
    language: 'fr',
    totalDurationTargetS: 30,
    scenes: [
      {
        sceneIndex: 1,
        title: 'Scène 1',
        durationTargetS: 15,
        lines: [
          {
            lineIndex: 0,
            speaker: 'narrateur',
            text: 'Bonjour le monde',
            tone: 'neutre',
            pace: 'normal',
            emphasis: ['monde'],
            estimatedDurationS: 2,
          },
          {
            lineIndex: 1,
            speaker: 'narrateur',
            text: 'Ceci est un test',
            tone: 'neutre',
            pace: 'normal',
            emphasis: [],
            estimatedDurationS: 2,
          },
        ],
        silences: [],
        stageDirections: 'Ton calme',
      },
      {
        sceneIndex: 2,
        title: 'Scène 2',
        durationTargetS: 15,
        lines: [
          {
            lineIndex: 0,
            speaker: 'personnage_A',
            text: 'Une dernière réplique',
            tone: 'grave',
            pace: 'slow',
            emphasis: ['dernière'],
            estimatedDurationS: 3,
          },
        ],
        silences: [],
        stageDirections: 'Ton solennel',
      },
    ],
  }

  beforeEach(async () => {
    storagePath = await mkdtemp(join(tmpdir(), 'tts-test-'))
  })

  afterEach(async () => {
    await rm(storagePath, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('retourne null si dialogue_script.json est absent', async () => {
    const { renderDialogueToTTS } = await import('../tts-renderer')
    const result = await renderDialogueToTTS({ storagePath, runId: 'r1' })
    expect(result).toBeNull()
  })

  it('retourne null si le script a 0 scènes', async () => {
    const emptyScript: DialogueScript = {
      runId: 'r1',
      language: 'fr',
      totalDurationTargetS: 0,
      scenes: [],
    }
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(emptyScript))

    const { renderDialogueToTTS } = await import('../tts-renderer')
    const result = await renderDialogueToTTS({ storagePath, runId: 'r1' })
    expect(result).toBeNull()
  })

  it('rend chaque ligne et produit un manifest correct', async () => {
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))

    const { executeWithFailover } = await import('@/lib/providers/failover')

    let callCount = 0
    vi.mocked(executeWithFailover).mockImplementation(async (_type, operation) => {
      callCount++
      const ttsDir = join(storagePath, 'tts')
      await mkdir(ttsDir, { recursive: true })

      // Simuler un fichier WAV créé par le provider
      const fakeFilePath = join(ttsDir, `tts-kokoro-${Date.now()}-${callCount}.wav`)
      await writeFile(fakeFilePath, Buffer.from('fake-wav-data'))

      const result = { filePath: fakeFilePath, duration: 2.5 + callCount * 0.1, costEur: 0 }
      return { result, provider: { name: 'kokoro-local', type: 'tts' } } as never
    })

    const { renderDialogueToTTS } = await import('../tts-renderer')
    const manifest = await renderDialogueToTTS({ storagePath, runId: 'test-run-1' })

    expect(manifest).not.toBeNull()
    expect(manifest!.runId).toBe('test-run-1')
    expect(manifest!.provider).toBe('kokoro-local')
    expect(manifest!.language).toBe('fr')
    expect(manifest!.lines).toHaveLength(3)

    // Vérifier les sceneIndex/lineIndex
    expect(manifest!.lines[0].sceneIndex).toBe(1)
    expect(manifest!.lines[0].lineIndex).toBe(0)
    expect(manifest!.lines[0].speaker).toBe('narrateur')
    expect(manifest!.lines[0].filePath).toBe('tts-scene1-line0.wav')

    expect(manifest!.lines[1].sceneIndex).toBe(1)
    expect(manifest!.lines[1].lineIndex).toBe(1)

    expect(manifest!.lines[2].sceneIndex).toBe(2)
    expect(manifest!.lines[2].lineIndex).toBe(0)
    expect(manifest!.lines[2].speaker).toBe('personnage_A')

    // Vérifier la durée
    expect(manifest!.lines[0].durationS).toBeGreaterThan(0)

    // Vérifier le fichier manifest sur disque
    const diskManifest = JSON.parse(
      await readFile(join(storagePath, 'tts_manifest.json'), 'utf-8'),
    )
    expect(diskManifest.lines).toHaveLength(3)
  })

  it('skip les lignes en échec mais continue les autres', async () => {
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))

    const { executeWithFailover } = await import('@/lib/providers/failover')

    let callCount = 0
    vi.mocked(executeWithFailover).mockImplementation(async (_type, operation) => {
      callCount++
      // Ligne 2 échoue
      if (callCount === 2) {
        throw new Error('Provider TTS indisponible')
      }

      const ttsDir = join(storagePath, 'tts')
      await mkdir(ttsDir, { recursive: true })
      const fakeFilePath = join(ttsDir, `tts-kokoro-${Date.now()}-${callCount}.wav`)
      await writeFile(fakeFilePath, Buffer.from('fake-wav'))

      return {
        result: { filePath: fakeFilePath, duration: 2.0, costEur: 0 },
        provider: { name: 'kokoro-local', type: 'tts' },
      } as never
    })

    const { renderDialogueToTTS } = await import('../tts-renderer')
    const manifest = await renderDialogueToTTS({ storagePath, runId: 'test-run-1' })

    // 3 lignes au total, 1 échoue → 2 rendues
    expect(manifest).not.toBeNull()
    expect(manifest!.lines).toHaveLength(2)
  })

  it('retourne null si toutes les lignes échouent', async () => {
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(sampleScript))

    const { executeWithFailover } = await import('@/lib/providers/failover')
    vi.mocked(executeWithFailover).mockRejectedValue(new Error('Tous les providers down'))

    const { renderDialogueToTTS } = await import('../tts-renderer')
    const manifest = await renderDialogueToTTS({ storagePath, runId: 'test-run-1' })

    expect(manifest).toBeNull()
  })

  it('skip les lignes avec texte vide', async () => {
    const scriptWithEmpty: DialogueScript = {
      runId: 'r1',
      language: 'fr',
      totalDurationTargetS: 10,
      scenes: [
        {
          sceneIndex: 1,
          title: 'Scène 1',
          durationTargetS: 10,
          lines: [
            { lineIndex: 0, speaker: 'narrateur', text: '', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 0 },
            { lineIndex: 1, speaker: 'narrateur', text: '  ', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 0 },
            { lineIndex: 2, speaker: 'narrateur', text: 'Texte réel', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 2 },
          ],
          silences: [],
          stageDirections: '',
        },
      ],
    }
    await writeFile(join(storagePath, 'dialogue_script.json'), JSON.stringify(scriptWithEmpty))

    const { executeWithFailover } = await import('@/lib/providers/failover')
    vi.mocked(executeWithFailover).mockImplementation(async () => {
      const ttsDir = join(storagePath, 'tts')
      await mkdir(ttsDir, { recursive: true })
      const fp = join(ttsDir, `tts-kokoro-${Date.now()}.wav`)
      await writeFile(fp, Buffer.from('wav'))
      return {
        result: { filePath: fp, duration: 2.0, costEur: 0 },
        provider: { name: 'kokoro-local', type: 'tts' },
      } as never
    })

    const { renderDialogueToTTS } = await import('../tts-renderer')
    const manifest = await renderDialogueToTTS({ storagePath, runId: 'r1' })

    // Seule la ligne 2 (texte réel) doit être rendue
    expect(manifest).not.toBeNull()
    expect(manifest!.lines).toHaveLength(1)
    expect(manifest!.lines[0].lineIndex).toBe(2)
  })
})
