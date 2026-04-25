import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFileSync, existsSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { WhisperTranscript, WhisperSegment, WhisperWord } from '../whisper-bridge'
import { generateSRTFromWhisper, generateSRT } from '../subtitles'

/**
 * Lot 1A + 1B — Tests contrat JSON + SRT exact + fallback.
 * Vérifie la structure sans appeler Python (tests unitaires purs).
 */

// Fixture : sortie type du script Python
const SAMPLE_TRANSCRIPT: WhisperTranscript = {
  language: 'fr',
  language_probability: 1.0,
  duration_s: 40.893,
  model_used: 'tiny',
  device: 'cpu',
  compute_type: 'int8',
  load_time_s: 3.23,
  transcribe_time_s: 2.55,
  segment_count: 2,
  word_count: 5,
  segments: [
    {
      start_s: 0.0,
      end_s: 2.5,
      text: 'Bonjour à tous',
      words: [
        { word: 'Bonjour', start_s: 0.0, end_s: 0.8, confidence: 0.97 },
        { word: 'à', start_s: 0.8, end_s: 0.9, confidence: 0.95 },
        { word: 'tous', start_s: 0.9, end_s: 1.3, confidence: 0.98 },
      ],
    },
    {
      start_s: 2.5,
      end_s: 4.0,
      text: 'bienvenue ici',
      words: [
        { word: 'bienvenue', start_s: 2.5, end_s: 3.2, confidence: 0.96 },
        { word: 'ici', start_s: 3.2, end_s: 3.8, confidence: 0.94 },
      ],
    },
  ],
}

describe('Lot 1A — Contrat JSON canonique whisper-bridge', () => {
  it('la structure racine contient les champs obligatoires', () => {
    expect(SAMPLE_TRANSCRIPT).toHaveProperty('language')
    expect(SAMPLE_TRANSCRIPT).toHaveProperty('duration_s')
    expect(SAMPLE_TRANSCRIPT).toHaveProperty('model_used')
    expect(SAMPLE_TRANSCRIPT).toHaveProperty('segments')
    expect(SAMPLE_TRANSCRIPT.segments).toBeInstanceOf(Array)
  })

  it('chaque segment a start_s, end_s, text, words[]', () => {
    for (const seg of SAMPLE_TRANSCRIPT.segments) {
      expect(seg).toHaveProperty('start_s')
      expect(seg).toHaveProperty('end_s')
      expect(seg).toHaveProperty('text')
      expect(seg).toHaveProperty('words')
      expect(seg.words).toBeInstanceOf(Array)
      expect(seg.end_s).toBeGreaterThan(seg.start_s)
    }
  })

  it('chaque mot a word, start_s, end_s, confidence', () => {
    for (const seg of SAMPLE_TRANSCRIPT.segments) {
      for (const w of seg.words) {
        expect(w).toHaveProperty('word')
        expect(w).toHaveProperty('start_s')
        expect(w).toHaveProperty('end_s')
        expect(w).toHaveProperty('confidence')
        expect(typeof w.word).toBe('string')
        expect(w.word.length).toBeGreaterThan(0)
        expect(w.confidence).toBeGreaterThanOrEqual(0)
        expect(w.confidence).toBeLessThanOrEqual(1)
      }
    }
  })

  it('les timestamps sont ordonnés', () => {
    let lastEnd = 0
    for (const seg of SAMPLE_TRANSCRIPT.segments) {
      expect(seg.start_s).toBeGreaterThanOrEqual(lastEnd - 0.01) // tolérance 10ms
      lastEnd = seg.end_s
      let wordLastEnd = seg.start_s
      for (const w of seg.words) {
        expect(w.start_s).toBeGreaterThanOrEqual(wordLastEnd - 0.01)
        wordLastEnd = w.end_s
      }
    }
  })

  it('word_count correspond au nombre total de mots', () => {
    const totalWords = SAMPLE_TRANSCRIPT.segments.reduce((acc, s) => acc + s.words.length, 0)
    expect(SAMPLE_TRANSCRIPT.word_count).toBe(totalWords)
  })

  it('segment_count correspond au nombre de segments', () => {
    expect(SAMPLE_TRANSCRIPT.segment_count).toBe(SAMPLE_TRANSCRIPT.segments.length)
  })
})

// ─── Lot 1B — SRT exact depuis whisper ────────────────────────────────────────

const FIXTURE_DIR_1B = join(__dirname, '__fixtures_lot1b__')

describe('Lot 1B — SRT exact depuis transcript word-level', () => {
  beforeEach(() => {
    rmSync(FIXTURE_DIR_1B, { recursive: true, force: true })
    mkdirSync(FIXTURE_DIR_1B, { recursive: true })
  })

  afterAll(() => {
    rmSync(FIXTURE_DIR_1B, { recursive: true, force: true })
  })

  it('génère un SRT avec timestamps exacts du whisper (pas proportionnels)', async () => {
    const srtPath = await generateSRTFromWhisper(SAMPLE_TRANSCRIPT.segments, FIXTURE_DIR_1B)

    expect(existsSync(srtPath)).toBe(true)
    const content = readFileSync(srtPath, 'utf-8')

    // Les timestamps doivent correspondre aux segments whisper, pas à un calcul proportionnel
    // Segment 1 : 0.0 → 2.5
    expect(content).toContain('00:00:00,000 --> 00:00:02,500')
    // Segment 2 : 2.5 → 4.0
    expect(content).toContain('00:00:02,500 --> 00:00:04,000')

    expect(content).toContain('Bonjour à tous')
    expect(content).toContain('bienvenue ici')
  })

  it('découpe les segments longs (>8s) en sous-blocs basés sur les mots', async () => {
    const longSegment: WhisperSegment = {
      start_s: 0.0,
      end_s: 18.0,
      text: 'mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9 mot10',
      words: Array.from({ length: 10 }, (_, i) => ({
        word: `mot${i + 1}`,
        start_s: i * 1.8,
        end_s: (i + 1) * 1.8,
        confidence: 0.95,
      })),
    }

    const srtPath = await generateSRTFromWhisper([longSegment], FIXTURE_DIR_1B)
    const content = readFileSync(srtPath, 'utf-8')

    // Le segment de 18s doit être découpé en au moins 2 sous-blocs
    const entries = content.split('\n\n').filter(Boolean)
    expect(entries.length).toBeGreaterThanOrEqual(2)
  })

  it('rejette si aucun segment valide', async () => {
    await expect(generateSRTFromWhisper([], FIXTURE_DIR_1B)).rejects.toThrow('Aucun segment')
  })

  it('le fallback proportionnel produit toujours un SRT valide', async () => {
    const scenes = [
      { sceneIndex: 0, dialogue: 'Ceci est une phrase de test pour le fallback proportionnel.' },
    ]
    const srtPath = await generateSRT(scenes, 5, FIXTURE_DIR_1B)
    expect(existsSync(srtPath)).toBe(true)
    const content = readFileSync(srtPath, 'utf-8')
    expect(content).toContain('-->')
    // Le contenu doit contenir au moins un mot du dialogue
    expect(content).toContain('Ceci')
  })
})
