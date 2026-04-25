/**
 * B4 — Générateur de sous-titres SRT pour le pipeline.
 *
 * Stratégie en deux niveaux :
 *   1. Transcription word-level via faster-whisper (timestamps exacts)
 *   2. Fallback : timing proportionnel par caractère depuis dialogue_script.json
 *
 * Non-bloquant : retourne null sur toute erreur ou absence d'audio.
 */
import { readFile } from 'fs/promises'
import { join } from 'path'
import { logger } from '@/lib/logger'
import { generateSRT, generateSRTFromWhisper } from './subtitles'
import { transcribeWordLevel } from './whisper-bridge'
import { probeMediaDuration } from './ffmpeg-media'

// ─── Types ───

export type SRTSource = 'whisper' | 'proportional'

export type SRTResult = {
  srtPath: string
  source: SRTSource
}

// ─── Source canonique : dialogue_script.json ───

type DialogueLine = { text: string }
type DialogueSceneRaw = { sceneIndex: number; lines?: DialogueLine[] }
type DialogueScriptRaw = { scenes?: DialogueSceneRaw[] }

type StructureSceneRaw = { dialogue?: string }
type StructureRaw = { scenes?: StructureSceneRaw[] }

/**
 * Construit la liste de dialogues depuis dialogue_script.json (source préférée).
 * Fallback : structure.json si dialogue_script.json absent.
 */
async function loadDialogues(
  storagePath: string,
): Promise<{ sceneIndex: number; dialogue: string }[]> {
  // Source préférée : dialogue_script.json (produit par step-3)
  try {
    const raw = await readFile(join(storagePath, 'dialogue_script.json'), 'utf-8')
    const script = JSON.parse(raw) as DialogueScriptRaw
    const dialogues = (script.scenes ?? [])
      .map((s) => ({
        sceneIndex: s.sceneIndex,
        dialogue: (s.lines ?? []).map((l) => l.text).join(' ').trim(),
      }))
      .filter((s) => s.dialogue.length > 0)
    if (dialogues.length > 0) return dialogues
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    // ENOENT uniquement → fallback structure.json
  }

  // Fallback : structure.json
  const raw = await readFile(join(storagePath, 'structure.json'), 'utf-8')
  const structure = JSON.parse(raw) as StructureRaw
  return (structure.scenes ?? [])
    .map((s, i) => ({ sceneIndex: i, dialogue: s.dialogue?.trim() ?? '' }))
    .filter((s) => s.dialogue.length > 0)
}

// ─── API publique ───

export type GenerateSRTParams = {
  audioPath: string
  storagePath: string
  outputDir: string
  runId: string
  language?: string
  modelSize?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
}

/**
 * Génère un fichier SRT pour la preview/finale.
 *
 * Ordre de priorité :
 *   1. faster-whisper (word-level, timestamps exacts)
 *   2. Timing proportionnel depuis dialogue_script.json ou structure.json
 *
 * Retourne null si aucune méthode ne produit de résultat.
 */
export async function generateSubtitles(params: GenerateSRTParams): Promise<SRTResult | null> {
  const { audioPath, storagePath, outputDir, runId, language = 'fr', modelSize = 'base' } = params

  // ─── Tentative 1 : faster-whisper ───
  try {
    const transcript = await transcribeWordLevel({
      audio_path: audioPath,
      language,
      model_size: modelSize,
      output_path: join(outputDir, 'transcript-word-level.json'),
    })

    if (transcript && transcript.segments.length > 0) {
      const srtPath = await generateSRTFromWhisper(transcript.segments, outputDir)
      logger.info({
        event: 'srt_generated_whisper',
        runId,
        path: srtPath,
        word_count: transcript.word_count,
        transcribe_time_s: transcript.transcribe_time_s,
      })
      return { srtPath, source: 'whisper' }
    }
  } catch (e) {
    logger.warn({ event: 'whisper_transcription_failed', runId, error: (e as Error).message })
  }

  // ─── Tentative 2 : timing proportionnel ───
  try {
    const dialogues = await loadDialogues(storagePath)
    if (dialogues.length === 0) {
      logger.warn({ event: 'srt_no_dialogue', runId })
      return null
    }

    const audioDuration = await probeMediaDuration(audioPath, 60)
    const srtPath = await generateSRT(dialogues, audioDuration, outputDir)
    logger.info({ event: 'srt_generated_proportional', runId, path: srtPath })
    return { srtPath, source: 'proportional' }
  } catch (e) {
    logger.warn({ event: 'srt_generation_failed', runId, error: (e as Error).message })
    return null
  }
}
