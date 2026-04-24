import { spawn } from 'child_process'
import { join } from 'path'
import { copyFile, mkdir } from 'fs/promises'
import type { SceneAudioPackage } from '@/types/audio'
import type { TTSManifest, TTSManifestLine } from '@/lib/pipeline/tts-renderer'

// ─── Types ───

export type SceneTTSResult = {
  sceneIndex: number
  concatFilePath: string
  totalDurationS: number
  lineCount: number
  silenceCount: number
  provider: string
  costEur: number
}

// ─── FFmpeg helpers ───

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'

function generateSilenceWav(durationS: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, [
      '-f', 'lavfi',
      '-i', `anullsrc=r=44100:cl=mono`,
      '-t', String(durationS),
      '-y',
      outputPath,
    ])

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg silence generation failed (code ${code}): ${stderr}`))
    })

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`))
    })
  })
}

function concatWavFiles(files: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const inputs: string[] = []
    const filterParts: string[] = []

    for (let i = 0; i < files.length; i++) {
      inputs.push('-i', files[i])
      filterParts.push(`[${i}:a]`)
    }

    const filterComplex = `${filterParts.join('')}concat=n=${files.length}:v=0:a=1[out]`

    const proc = spawn(FFMPEG_BIN, [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-y',
      outputPath,
    ])

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg concat failed (code ${code}): ${stderr}`))
    })

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`))
    })
  })
}

// ─── Core ───

/**
 * Assemble le TTS d'une scene :
 * - Recupere les WAV des lignes depuis un TTSManifest deja rendu
 * - Genere les silences WAV intermediaires
 * - Concat le tout en un seul WAV
 */
export async function assembleSceneTTS(params: {
  scene: SceneAudioPackage
  ttsManifest: TTSManifest
  ttsDir: string
  outputDir: string
}): Promise<SceneTTSResult> {
  const { scene, ttsManifest, ttsDir, outputDir } = params
  const { sceneIndex } = scene

  // Filter manifest lines for this scene
  const sceneLines = ttsManifest.lines.filter(
    (line) => line.sceneIndex === sceneIndex,
  )

  if (sceneLines.length === 0) {
    throw new Error(
      `No TTS lines found for scene ${sceneIndex} in manifest (runId: ${ttsManifest.runId})`,
    )
  }

  // Sort lines by lineIndex for deterministic ordering
  const sortedLines = [...sceneLines].sort((a, b) => a.lineIndex - b.lineIndex)

  // Index silences by afterLineIndex for fast lookup
  const silenceMap = new Map<number, number>()
  for (const silence of scene.narration.silences) {
    silenceMap.set(silence.afterLineIndex, silence.durationS)
  }

  await mkdir(outputDir, { recursive: true })

  // Build ordered list of segments (line wav, then optional silence wav)
  const segments: string[] = []
  let totalDurationS = 0
  let silenceCount = 0

  for (const line of sortedLines) {
    // Add the line WAV
    const lineWavPath = join(ttsDir, line.filePath)
    segments.push(lineWavPath)
    totalDurationS += line.durationS

    // Check if there's a silence after this line
    const silenceDuration = silenceMap.get(line.lineIndex)
    if (silenceDuration !== undefined) {
      const silencePath = join(
        outputDir,
        `silence-scene${sceneIndex}-after${line.lineIndex}.wav`,
      )
      await generateSilenceWav(silenceDuration, silencePath)
      segments.push(silencePath)
      totalDurationS += silenceDuration
      silenceCount++
    }
  }

  const concatFilePath = join(outputDir, `tts-scene${sceneIndex}.wav`)

  if (segments.length === 1) {
    // Single segment — copy directly, no FFmpeg concat needed
    await copyFile(segments[0], concatFilePath)
  } else {
    await concatWavFiles(segments, concatFilePath)
  }

  return {
    sceneIndex,
    concatFilePath,
    totalDurationS: Number(totalDurationS.toFixed(3)),
    lineCount: sortedLines.length,
    silenceCount,
    provider: ttsManifest.provider,
    costEur: 0, // Cost tracking is handled upstream
  }
}
