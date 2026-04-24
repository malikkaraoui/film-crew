import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { spawn } from 'child_process'
import type { TTSManifest } from './tts-renderer'
import type { DialogueScript, AudioTimeline, AudioSegment } from '@/types/audio'
import { logger } from '@/lib/logger'

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'
const CROSSFADE_MS = 200
const SAMPLE_RATE = 24000
const CHANNELS = 1

// ─── Types ───

export type AudioAssemblyResult = {
  audioPreviewPath: string
  timeline: AudioTimeline
  totalDurationS: number
}

// ─── Helpers ───

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
    })
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn: ${err.message}`)))
  })
}

/**
 * Génère un fichier WAV de silence avec ffmpeg.
 */
async function generateSilence(outputPath: string, durationS: number): Promise<void> {
  await runFFmpeg([
    '-f', 'lavfi',
    '-i', `anullsrc=r=${SAMPLE_RATE}:cl=mono`,
    '-t', durationS.toFixed(3),
    '-ar', String(SAMPLE_RATE),
    '-ac', String(CHANNELS),
    '-y', outputPath,
  ])
}

/**
 * Concatène une liste de fichiers WAV en un seul via ffmpeg concat demuxer.
 */
async function concatWavFiles(inputPaths: string[], outputPath: string): Promise<void> {
  // Créer le fichier de liste pour le concat demuxer
  const listPath = outputPath + '.concat.txt'
  const listContent = inputPaths.map((p) => `file '${p}'`).join('\n')
  await writeFile(listPath, listContent)

  await runFFmpeg([
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-ar', String(SAMPLE_RATE),
    '-ac', String(CHANNELS),
    '-c:a', 'pcm_s16le',
    '-y', outputPath,
  ])

  // Nettoyer le fichier de liste
  const { rm } = await import('fs/promises')
  await rm(listPath, { force: true }).catch(() => {})
}

// ─── Core ───

/**
 * Assemble les WAV TTS + silences en un seul audio_preview.wav.
 *
 * Lit :
 * - tts_manifest.json (produit par B2a)
 * - dialogue_script.json (produit par A3, pour les SilenceMarker)
 *
 * Produit :
 * - audio/audio_preview.wav
 * - audio_timeline.json (type AudioTimeline)
 */
export async function assembleDialogueAudio(params: {
  storagePath: string
  runId: string
  crossfadeMs?: number
}): Promise<AudioAssemblyResult | null> {
  const { storagePath, runId, crossfadeMs = CROSSFADE_MS } = params

  // Lire le manifest TTS
  let manifest: TTSManifest
  try {
    const raw = await readFile(join(storagePath, 'tts_manifest.json'), 'utf-8')
    manifest = JSON.parse(raw) as TTSManifest
  } catch (error) {
    logger.warn({ event: 'audio_assemble_no_manifest', runId, error: (error as Error).message })
    return null
  }

  if (manifest.lines.length === 0) {
    logger.warn({ event: 'audio_assemble_empty_manifest', runId })
    return null
  }

  // Lire le dialogue script pour les silences
  let script: DialogueScript | null = null
  try {
    const raw = await readFile(join(storagePath, 'dialogue_script.json'), 'utf-8')
    script = JSON.parse(raw) as DialogueScript
  } catch {
    // silences non disponibles — on assemble sans
  }

  // Construire la map des silences par scène/lineIndex
  const silenceMap = new Map<string, number>() // "sceneIndex:afterLineIndex" → durationS
  if (script) {
    for (const scene of script.scenes) {
      for (const silence of scene.silences) {
        silenceMap.set(`${scene.sceneIndex}:${silence.afterLineIndex}`, silence.durationS)
      }
    }
  }

  const ttsDir = join(storagePath, 'tts')
  const audioDir = join(storagePath, 'audio')
  await mkdir(audioDir, { recursive: true })

  // Construire la séquence d'assemblage : WAV + silences intercalés
  const segments: AudioSegment[] = []
  const filesToConcat: string[] = []
  let currentTimeS = 0
  let segmentIndex = 0
  let prevSceneIndex = -1

  for (const line of manifest.lines) {
    // Crossfade entre scènes (silence court)
    if (prevSceneIndex !== -1 && line.sceneIndex !== prevSceneIndex) {
      const crossfadeS = crossfadeMs / 1000
      const silencePath = join(audioDir, `silence-crossfade-${segmentIndex}.wav`)
      await generateSilence(silencePath, crossfadeS)
      filesToConcat.push(silencePath)

      segments.push({
        segmentIndex,
        sceneIndex: line.sceneIndex,
        type: 'transition',
        startS: Number(currentTimeS.toFixed(3)),
        endS: Number((currentTimeS + crossfadeS).toFixed(3)),
        durationS: Number(crossfadeS.toFixed(3)),
        content: {
          musicActive: false,
          ambianceActive: false,
          fxActive: [],
        },
        videoPromptHint: 'transition entre scènes',
      })

      currentTimeS += crossfadeS
      segmentIndex++
    }

    // WAV de la ligne
    const wavPath = join(ttsDir, line.filePath)
    filesToConcat.push(wavPath)

    // Retrouver la DialogueLine originale pour enrichir le segment
    const sceneDef = script?.scenes.find((s) => s.sceneIndex === line.sceneIndex)
    const lineDef = sceneDef?.lines.find((l) => l.lineIndex === line.lineIndex)

    segments.push({
      segmentIndex,
      sceneIndex: line.sceneIndex,
      type: 'dialogue',
      startS: Number(currentTimeS.toFixed(3)),
      endS: Number((currentTimeS + line.durationS).toFixed(3)),
      durationS: line.durationS,
      content: {
        dialogueLine: lineDef,
        musicActive: false,
        ambianceActive: false,
        fxActive: [],
      },
      videoPromptHint: lineDef
        ? `${line.speaker} parle, ton ${lineDef.tone}, rythme ${lineDef.pace}`
        : `${line.speaker} parle`,
    })

    currentTimeS += line.durationS
    segmentIndex++
    prevSceneIndex = line.sceneIndex

    // Silence après cette ligne ?
    const silenceKey = `${line.sceneIndex}:${line.lineIndex}`
    const silenceDuration = silenceMap.get(silenceKey)
    if (silenceDuration && silenceDuration > 0) {
      const silencePath = join(audioDir, `silence-${segmentIndex}.wav`)
      await generateSilence(silencePath, silenceDuration)
      filesToConcat.push(silencePath)

      const silenceMarker = sceneDef?.silences.find((s) => s.afterLineIndex === line.lineIndex)

      segments.push({
        segmentIndex,
        sceneIndex: line.sceneIndex,
        type: 'silence',
        startS: Number(currentTimeS.toFixed(3)),
        endS: Number((currentTimeS + silenceDuration).toFixed(3)),
        durationS: Number(silenceDuration.toFixed(3)),
        content: {
          silenceMarker: silenceMarker ?? undefined,
          musicActive: false,
          ambianceActive: false,
          fxActive: [],
        },
        videoPromptHint: silenceMarker
          ? `silence — ${silenceMarker.purpose}`
          : 'silence',
      })

      currentTimeS += silenceDuration
      segmentIndex++
    }
  }

  if (filesToConcat.length === 0) {
    logger.warn({ event: 'audio_assemble_no_files', runId })
    return null
  }

  // Concaténer tous les fichiers
  const audioPreviewPath = join(audioDir, 'audio_preview.wav')

  logger.info({
    event: 'audio_assemble_start',
    runId,
    fileCount: filesToConcat.length,
    segmentCount: segments.length,
  })

  await concatWavFiles(filesToConcat, audioPreviewPath)

  // Construire la timeline
  const timeline: AudioTimeline = {
    runId,
    totalDurationS: Number(currentTimeS.toFixed(3)),
    segments,
  }

  await writeFile(
    join(storagePath, 'audio_timeline.json'),
    JSON.stringify(timeline, null, 2),
  )

  logger.info({
    event: 'audio_assemble_complete',
    runId,
    totalDurationS: Number(currentTimeS.toFixed(3)),
    segmentCount: segments.length,
    dialogueSegments: segments.filter((s) => s.type === 'dialogue').length,
    silenceSegments: segments.filter((s) => s.type === 'silence').length,
  })

  return {
    audioPreviewPath,
    timeline,
    totalDurationS: Number(currentTimeS.toFixed(3)),
  }
}
