/**
 * Génération SRT + filtre sous-titres FFmpeg.
 * Réutilise les conventions ASS du module viral (force_style, FontName, etc.)
 */
import { writeFile } from 'fs/promises'
import { join } from 'path'

export type SubtitleStyle = {
  fontName?: string
  fontSize?: number
  primaryColor?: string   // format ASS: '&H00FFFFFF'
  outlineColor?: string
  outlineWidth?: number
  bold?: boolean
  marginBottom?: number
}

export type SceneDialogue = {
  sceneIndex: number
  dialogue: string
}

/** Convertit secondes en format SRT : 00:01:23,456 */
function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

/**
 * Génère un fichier SRT à partir des dialogues de scènes.
 * Timing proportionnel par caractère. Max 8s/segment.
 */
export async function generateSRT(
  scenes: SceneDialogue[],
  totalAudioDurationSeconds: number,
  outputDir: string,
): Promise<string> {
  const validScenes = scenes.filter((s) => s.dialogue.trim().length > 0)
  if (validScenes.length === 0) throw new Error('Aucun dialogue pour générer SRT')

  const totalChars = validScenes.reduce((acc, s) => acc + s.dialogue.length, 0)
  const srtLines: string[] = []
  let cursor = 0.5
  let counter = 1

  for (const scene of validScenes) {
    const proportion = scene.dialogue.length / totalChars
    const sceneAudioDuration = totalAudioDurationSeconds * proportion

    const words = scene.dialogue.split(' ')
    const SEGMENT_MAX_S = 8
    const segmentCount = Math.ceil(sceneAudioDuration / SEGMENT_MAX_S)
    const wordsPerSegment = Math.ceil(words.length / segmentCount)
    const segmentDuration = sceneAudioDuration / segmentCount

    for (let i = 0; i < segmentCount; i++) {
      const segWords = words.slice(i * wordsPerSegment, (i + 1) * wordsPerSegment)
      if (segWords.length === 0) continue

      const start = cursor + i * segmentDuration
      const end = start + segmentDuration - 0.05

      srtLines.push(`${counter}`)
      srtLines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`)
      srtLines.push(segWords.join(' '))
      srtLines.push('')
      counter++
    }

    cursor += sceneAudioDuration
  }

  const srtPath = join(outputDir, 'subtitles.srt')
  await writeFile(srtPath, srtLines.join('\n'), 'utf-8')
  return srtPath
}

// ─── SRT exact depuis transcript word-level (Lot 1B) ─────────────────────────

import type { WhisperSegment } from './whisper-bridge'

/**
 * Génère un SRT exact depuis un transcript word-level (faster-whisper).
 * Les timestamps viennent directement du moteur de transcription — pas de calcul proportionnel.
 */
export async function generateSRTFromWhisper(
  segments: WhisperSegment[],
  outputDir: string,
): Promise<string> {
  const validSegments = segments.filter((s) => s.text.trim().length > 0)
  if (validSegments.length === 0) throw new Error('Aucun segment whisper pour générer SRT')

  const srtLines: string[] = []
  let counter = 1

  for (const seg of validSegments) {
    // Découper les segments longs (>8s) en sous-blocs basés sur les mots
    const MAX_DURATION = 8
    const segDuration = seg.end_s - seg.start_s

    if (segDuration <= MAX_DURATION || seg.words.length === 0) {
      srtLines.push(`${counter}`)
      srtLines.push(`${formatSrtTime(seg.start_s)} --> ${formatSrtTime(seg.end_s)}`)
      srtLines.push(seg.text)
      srtLines.push('')
      counter++
      continue
    }

    // Split en sous-blocs de ~MAX_DURATION secondes en coupant aux mots
    let blockStart = seg.words[0].start_s
    let blockWords: string[] = []

    for (const w of seg.words) {
      blockWords.push(w.word)
      const blockDuration = w.end_s - blockStart

      if (blockDuration >= MAX_DURATION) {
        srtLines.push(`${counter}`)
        srtLines.push(`${formatSrtTime(blockStart)} --> ${formatSrtTime(w.end_s)}`)
        srtLines.push(blockWords.join(' '))
        srtLines.push('')
        counter++
        blockStart = w.end_s
        blockWords = []
      }
    }

    // Flush le reste
    if (blockWords.length > 0) {
      const lastWord = seg.words[seg.words.length - 1]
      srtLines.push(`${counter}`)
      srtLines.push(`${formatSrtTime(blockStart)} --> ${formatSrtTime(lastWord.end_s)}`)
      srtLines.push(blockWords.join(' '))
      srtLines.push('')
      counter++
    }
  }

  const srtPath = join(outputDir, 'subtitles.srt')
  await writeFile(srtPath, srtLines.join('\n'), 'utf-8')
  return srtPath
}

/**
 * Construit le filtre FFmpeg subtitles avec force_style ASS.
 * Compatible avec les conventions du module viral (même structure force_style).
 */
export function buildSubtitleFilter(srtPath: string, style: SubtitleStyle = {}): string {
  const {
    fontName = 'Arial',
    fontSize = 48,
    primaryColor = '&H00FFFFFF',
    outlineColor = '&H00000000',
    outlineWidth = 2,
    bold = true,
    marginBottom = 80,
  } = style

  const escapedPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')

  const forceStyle = [
    `FontName=${fontName}`,
    `FontSize=${fontSize}`,
    `PrimaryColour=${primaryColor}`,
    `OutlineColour=${outlineColor}`,
    `Outline=${outlineWidth}`,
    `Bold=${bold ? '1' : '0'}`,
    `MarginV=${marginBottom}`,
  ].join(',')

  return `subtitles='${escapedPath}':force_style='${forceStyle}'`
}
