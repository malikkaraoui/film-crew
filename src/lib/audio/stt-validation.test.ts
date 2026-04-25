import { describe, it, expect, vi } from 'vitest'
import { computeWER, runSttValidation } from './stt-validation'
import type { SttValidationInput } from './stt-validation'
import type { DialogueScript } from '@/types/audio'

vi.mock('@/lib/pipeline/whisper-bridge')
import { transcribeWordLevel } from '@/lib/pipeline/whisper-bridge'
import type { MockedFunction } from 'vitest'

const mockTranscribe = transcribeWordLevel as MockedFunction<typeof transcribeWordLevel>

// ─── Fixtures ───

function makeScript(lines: string[]): DialogueScript {
  return {
    runId: 'test',
    language: 'fr',
    totalDurationTargetS: 10,
    scenes: [
      {
        sceneIndex: 0,
        title: 'Scène 0',
        durationTargetS: 10,
        stageDirections: '',
        silences: [],
        lines: lines.map((text, i) => ({
          lineIndex: i,
          speaker: 'narrateur',
          text,
          tone: 'neutre',
          pace: 'normal' as const,
          emphasis: [],
          estimatedDurationS: 2,
        })),
      },
    ],
  }
}

function makeTranscript(texts: string[]) {
  return {
    language: 'fr',
    language_probability: 0.99,
    duration_s: 10,
    model_used: 'tiny',
    device: 'cpu',
    compute_type: 'int8',
    load_time_s: 1.0,
    transcribe_time_s: 0.5,
    segment_count: texts.length,
    word_count: texts.join(' ').split(' ').length,
    segments: texts.map((text, i) => ({
      start_s: i * 2,
      end_s: (i + 1) * 2,
      text,
      words: [],
    })),
  }
}

// ─── computeWER ───

describe('computeWER', () => {
  it('référence = hypothèse → wer = 0', () => {
    expect(computeWER('bonjour le monde', 'bonjour le monde')).toBe(0)
  })

  it('hypothèse vide → wer = 1', () => {
    expect(computeWER('bonjour le monde', '')).toBe(1)
  })

  it('référence vide → wer = 0 (convention V1)', () => {
    expect(computeWER('', 'quelque chose')).toBe(0)
  })

  it('1 mot erroné sur 4 → wer = 0.25', () => {
    expect(computeWER('a b c d', 'a b c x')).toBeCloseTo(0.25)
  })

  it('substitution simple — 1 mot différent sur 3 → wer ≈ 0.33', () => {
    expect(computeWER('un deux trois', 'un deux quatre')).toBeCloseTo(1 / 3)
  })

  it('normalisation : casse ignorée', () => {
    expect(computeWER('Bonjour Monde', 'bonjour monde')).toBe(0)
  })

  it('normalisation : ponctuation ignorée', () => {
    expect(computeWER('bonjour, monde!', 'bonjour monde')).toBe(0)
  })

  it('wer clampé à 1 si hypothèse très différente', () => {
    const ref = 'a b'
    const hyp = 'x y z w v u'
    expect(computeWER(ref, hyp)).toBeLessThanOrEqual(1)
  })

  it('wer >= 0 dans tous les cas', () => {
    expect(computeWER('a b c', 'd e f')).toBeGreaterThanOrEqual(0)
  })
})

// ─── runSttValidation ───

describe('runSttValidation', () => {
  const baseInput: SttValidationInput = {
    masterPath: '/tmp/master.wav',
    script: makeScript(['bonjour le monde', 'au revoir']),
    language: 'fr',
  }

  it('transcribeWordLevel retourne null → undefined', async () => {
    mockTranscribe.mockResolvedValue(null)
    const result = await runSttValidation(baseInput)
    expect(result).toBeUndefined()
  })

  it('transcription OK → SttValidationResult avec enabled + wer + provider', async () => {
    mockTranscribe.mockResolvedValue(makeTranscript(['bonjour le monde', 'au revoir']))
    const result = await runSttValidation(baseInput)

    expect(result).not.toBeUndefined()
    expect(result!.enabled).toBe(true)
    expect(result!.wer).toBe(0)
    expect(result!.provider).toBe('faster-whisper/tiny')
  })

  it('provider = faster-whisper/<model_used>', async () => {
    const transcript = makeTranscript(['test'])
    transcript.model_used = 'small'
    mockTranscribe.mockResolvedValue(transcript)

    const result = await runSttValidation({ ...baseInput, modelSize: 'small' })
    expect(result!.provider).toBe('faster-whisper/small')
  })

  it('transcription partielle → wer > 0', async () => {
    mockTranscribe.mockResolvedValue(makeTranscript(['bonjour le monde', 'incorrect text']))
    const result = await runSttValidation(baseInput)

    expect(result).not.toBeUndefined()
    expect(result!.wer).toBeGreaterThan(0)
  })
})
