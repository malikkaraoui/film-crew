import { transcribeWordLevel } from '@/lib/pipeline/whisper-bridge'
import type { DialogueScript } from '@/types/audio'
import type { WhisperInput } from '@/lib/pipeline/whisper-bridge'

// ─── Types ───

export type SttValidationResult = {
  enabled: true
  wer: number       // 0.0–1.0
  provider: string  // ex. 'faster-whisper/tiny'
}

export type SttValidationInput = {
  masterPath: string
  script: DialogueScript
  language?: string
  modelSize?: WhisperInput['model_size']
}

// ─── computeWER ───

/**
 * Calcule le Word Error Rate entre une référence et une hypothèse.
 * Normalisation : lowercase, ponctuation supprimée, whitespace trimé.
 * Retourne 0 si reference est vide (convention V1 : pas de mots → pas d'erreur).
 * Clampé à [0, 1].
 */
export function computeWER(reference: string, hypothesis: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)

  const ref = normalize(reference)
  const hyp = normalize(hypothesis)

  if (ref.length === 0) return 0

  const dist = levenshteinWords(ref, hyp)
  return Math.min(1, dist / ref.length)
}

function levenshteinWords(a: string[], b: string[]): number {
  const m = a.length
  const n = b.length

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

// ─── runSttValidation ───

/**
 * Transcrit master.wav via whisper-bridge et calcule le WER.
 * Retourne undefined si STT indisponible ou échec (non bloquant).
 */
export async function runSttValidation(
  input: SttValidationInput,
): Promise<SttValidationResult | undefined> {
  const { masterPath, script, language, modelSize } = input

  const transcript = await transcribeWordLevel({
    audio_path: masterPath,
    language,
    model_size: modelSize ?? 'tiny',
  })

  if (!transcript) return undefined

  const hypothesis = transcript.segments.map((s) => s.text).join(' ')
  const reference = script.scenes
    .flatMap((scene) => scene.lines)
    .map((line) => line.text)
    .join(' ')

  const wer = computeWER(reference, hypothesis)

  return {
    enabled: true,
    wer,
    provider: `faster-whisper/${transcript.model_used}`,
  }
}
