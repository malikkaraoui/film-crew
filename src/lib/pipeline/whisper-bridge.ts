/**
 * Lot 1A — Bridge TypeScript → Python pour la transcription word-level.
 *
 * Appelle scripts/python/whisper/transcribe_word_level.py via child_process.spawn.
 * Contrat JSON canonique en entrée/sortie.
 */
import { spawn } from 'child_process'
import { join } from 'path'
import { logger } from '@/lib/logger'

// ─── Contrat JSON canonique ──────────────────────────────────────────────────

export type WhisperWord = {
  word: string
  start_s: number
  end_s: number
  confidence: number
}

export type WhisperSegment = {
  start_s: number
  end_s: number
  text: string
  words: WhisperWord[]
}

export type WhisperTranscript = {
  language: string
  language_probability: number
  duration_s: number
  model_used: string
  device: string
  compute_type: string
  load_time_s: number
  transcribe_time_s: number
  segment_count: number
  word_count: number
  segments: WhisperSegment[]
}

export type WhisperInput = {
  audio_path: string
  language?: string
  model_size?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
  output_path?: string
}

// ─── Bridge ──────────────────────────────────────────────────────────────────

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3'
const SCRIPT_PATH = join(process.cwd(), 'scripts', 'python', 'whisper', 'transcribe_word_level.py')

/**
 * Lance la transcription word-level via le script Python.
 * Retourne null si le script échoue (faster-whisper absent, fichier introuvable, etc.).
 */
export async function transcribeWordLevel(input: WhisperInput): Promise<WhisperTranscript | null> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, [SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    // Envoyer l'input JSON sur stdin
    proc.stdin.write(JSON.stringify(input))
    proc.stdin.end()

    proc.on('close', (code) => {
      if (code !== 0) {
        logger.warn({
          event: 'whisper_bridge_failed',
          code,
          stderr: stderr.slice(-500),
          message: 'Transcription word-level échouée — fallback timing proportionnel',
        })
        resolve(null)
        return
      }

      try {
        const result = JSON.parse(stdout) as WhisperTranscript
        logger.info({
          event: 'whisper_bridge_success',
          language: result.language,
          duration_s: result.duration_s,
          word_count: result.word_count,
          transcribe_time_s: result.transcribe_time_s,
        })
        resolve(result)
      } catch {
        logger.warn({
          event: 'whisper_bridge_parse_error',
          stdout: stdout.slice(-500),
        })
        resolve(null)
      }
    })

    proc.on('error', (err) => {
      logger.warn({
        event: 'whisper_bridge_spawn_error',
        error: err.message,
      })
      resolve(null)
    })
  })
}
