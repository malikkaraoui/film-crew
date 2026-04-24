import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'

vi.mock('./subtitles')
vi.mock('./whisper-bridge')
vi.mock('./ffmpeg-media')
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('fs/promises', () => ({ readFile: vi.fn() }))

import { readFile } from 'fs/promises'
import { generateSRT, generateSRTFromWhisper } from './subtitles'
import { transcribeWordLevel } from './whisper-bridge'
import { probeMediaDuration } from './ffmpeg-media'
import { generateSubtitles } from './subtitle-generator'
import type { WhisperTranscript } from './whisper-bridge'

// ─── Mocks typés ───

const mockReadFile = readFile as MockedFunction<typeof readFile>
const mockTranscribeWordLevel = transcribeWordLevel as MockedFunction<typeof transcribeWordLevel>
const mockGenerateSRTFromWhisper = generateSRTFromWhisper as MockedFunction<typeof generateSRTFromWhisper>
const mockGenerateSRT = generateSRT as MockedFunction<typeof generateSRT>
const mockProbeMediaDuration = probeMediaDuration as MockedFunction<typeof probeMediaDuration>

// ─── Fixtures ───

const PARAMS = {
  audioPath: '/tmp/run/audio/master.wav',
  storagePath: '/tmp/run',
  outputDir: '/tmp/run/final',
  runId: 'run_test',
}

const WHISPER_OK: WhisperTranscript = {
  language: 'fr',
  language_probability: 0.98,
  duration_s: 30,
  model_used: 'base',
  device: 'cpu',
  compute_type: 'int8',
  load_time_s: 1.2,
  transcribe_time_s: 3.5,
  segment_count: 2,
  word_count: 20,
  segments: [
    { start_s: 0, end_s: 5, text: 'Bonjour le monde', words: [
      { word: 'Bonjour', start_s: 0, end_s: 1, confidence: 0.99 },
      { word: 'le', start_s: 1.1, end_s: 1.4, confidence: 0.99 },
      { word: 'monde', start_s: 1.5, end_s: 2.3, confidence: 0.99 },
    ]},
  ],
}

const DIALOGUE_SCRIPT = JSON.stringify({
  scenes: [
    { sceneIndex: 0, lines: [{ text: 'Bonjour le monde.' }, { text: 'Comment allez-vous ?' }] },
    { sceneIndex: 1, lines: [{ text: 'Fin de la présentation.' }] },
  ],
})

const STRUCTURE_JSON = JSON.stringify({
  scenes: [
    { dialogue: 'Bonjour le monde.' },
    { dialogue: 'Fin.' },
  ],
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Cas 1 : whisper réussit → source = 'whisper' ───

describe('generateSubtitles — whisper disponible', () => {
  it('retourne srtPath et source=whisper si whisper réussit', async () => {
    mockTranscribeWordLevel.mockResolvedValue(WHISPER_OK)
    mockGenerateSRTFromWhisper.mockResolvedValue('/tmp/run/final/subtitles.srt')

    const result = await generateSubtitles(PARAMS)

    expect(result).not.toBeNull()
    expect(result!.source).toBe('whisper')
    expect(result!.srtPath).toBe('/tmp/run/final/subtitles.srt')
    expect(mockGenerateSRT).not.toHaveBeenCalled()
  })

  it('whisper appelé avec les bons paramètres', async () => {
    mockTranscribeWordLevel.mockResolvedValue(WHISPER_OK)
    mockGenerateSRTFromWhisper.mockResolvedValue('/tmp/run/final/subtitles.srt')

    await generateSubtitles(PARAMS)

    expect(mockTranscribeWordLevel).toHaveBeenCalledWith({
      audio_path: '/tmp/run/audio/master.wav',
      language: 'fr',
      model_size: 'base',
      output_path: '/tmp/run/final/transcript-word-level.json',
    })
  })
})

// ─── Cas 2 : whisper indisponible → fallback proportionnel (dialogue_script) ───

describe('generateSubtitles — whisper indisponible, fallback dialogue_script', () => {
  it('fallback proportionnel depuis dialogue_script.json si whisper retourne null', async () => {
    mockTranscribeWordLevel.mockResolvedValue(null)
    mockReadFile.mockResolvedValue(DIALOGUE_SCRIPT as never)
    mockProbeMediaDuration.mockResolvedValue(30)
    mockGenerateSRT.mockResolvedValue('/tmp/run/final/subtitles.srt')

    const result = await generateSubtitles(PARAMS)

    expect(result).not.toBeNull()
    expect(result!.source).toBe('proportional')
    expect(result!.srtPath).toBe('/tmp/run/final/subtitles.srt')
  })

  it('fallback proportionnel si whisper throw', async () => {
    mockTranscribeWordLevel.mockRejectedValue(new Error('faster-whisper absent'))
    mockReadFile.mockResolvedValue(DIALOGUE_SCRIPT as never)
    mockProbeMediaDuration.mockResolvedValue(30)
    mockGenerateSRT.mockResolvedValue('/tmp/run/final/subtitles.srt')

    const result = await generateSubtitles(PARAMS)

    expect(result).not.toBeNull()
    expect(result!.source).toBe('proportional')
  })

  it('fallback depuis structure.json si dialogue_script.json absent', async () => {
    mockTranscribeWordLevel.mockResolvedValue(null)
    // Premier readFile (dialogue_script.json) échoue, second (structure.json) réussit
    mockReadFile
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      .mockResolvedValueOnce(STRUCTURE_JSON as never)
    mockProbeMediaDuration.mockResolvedValue(20)
    mockGenerateSRT.mockResolvedValue('/tmp/run/final/subtitles.srt')

    const result = await generateSubtitles(PARAMS)

    expect(result).not.toBeNull()
    expect(result!.source).toBe('proportional')
  })

  it('generateSRT appelé avec la durée audio réelle', async () => {
    mockTranscribeWordLevel.mockResolvedValue(null)
    mockReadFile.mockResolvedValue(DIALOGUE_SCRIPT as never)
    mockProbeMediaDuration.mockResolvedValue(42)
    mockGenerateSRT.mockResolvedValue('/tmp/run/final/subtitles.srt')

    await generateSubtitles(PARAMS)

    expect(mockProbeMediaDuration).toHaveBeenCalledWith('/tmp/run/audio/master.wav', 60)
    const [, duration] = mockGenerateSRT.mock.calls[0]
    expect(duration).toBe(42)
  })
})

// ─── Cas 3 : whisper segments vides → fallback proportionnel ───

describe('generateSubtitles — whisper segments vides', () => {
  it('transcript sans segments → fallback proportionnel', async () => {
    mockTranscribeWordLevel.mockResolvedValue({ ...WHISPER_OK, segments: [] })
    mockReadFile.mockResolvedValue(DIALOGUE_SCRIPT as never)
    mockProbeMediaDuration.mockResolvedValue(30)
    mockGenerateSRT.mockResolvedValue('/tmp/run/final/subtitles.srt')

    const result = await generateSubtitles(PARAMS)

    expect(result!.source).toBe('proportional')
    expect(mockGenerateSRTFromWhisper).not.toHaveBeenCalled()
  })
})

// ─── Cas 4 : aucun dialogue → null ───

describe('generateSubtitles — aucun dialogue', () => {
  it('retourne null si dialogue_script et structure vides', async () => {
    mockTranscribeWordLevel.mockResolvedValue(null)
    // dialogue_script.json absent + structure.json sans dialogue
    mockReadFile
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      .mockResolvedValueOnce(JSON.stringify({ scenes: [{ dialogue: '' }, { dialogue: '   ' }] }) as never)

    const result = await generateSubtitles(PARAMS)

    expect(result).toBeNull()
    expect(mockGenerateSRT).not.toHaveBeenCalled()
  })

  it('retourne null si les deux fichiers source sont absents', async () => {
    mockTranscribeWordLevel.mockResolvedValue(null)
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await generateSubtitles(PARAMS)

    expect(result).toBeNull()
  })
})

// ─── Options ───

describe('generateSubtitles — options langue et modèle', () => {
  it('respecte les options language et modelSize custom', async () => {
    mockTranscribeWordLevel.mockResolvedValue(WHISPER_OK)
    mockGenerateSRTFromWhisper.mockResolvedValue('/tmp/run/final/subtitles.srt')

    await generateSubtitles({ ...PARAMS, language: 'en', modelSize: 'large-v3' })

    expect(mockTranscribeWordLevel).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en', model_size: 'large-v3' }),
    )
  })
})
