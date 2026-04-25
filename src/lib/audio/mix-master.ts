// ─── Mix Master — Assemblage WAV master + manifest ───
// V1 : concat simple (bout à bout). Pas de crossfade réel entre scènes.

import { spawn } from 'child_process'
import { mkdir, copyFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { SceneAudioRenderStatus, AudioMasterManifest } from '@/types/audio'

// ─── Types ───

/**
 * Entrée : données par scène déjà mixée.
 * Ce type ne contient PAS de startS/endS — ces valeurs sont CALCULÉES par computeTimeline.
 */
export type SceneMixInput = {
  sceneIndex: number
  durationS: number
  ttsFilePath: string
  mixFilePath: string
  ttsProvider: string
  costEur: number
}

// ─── FFmpeg binary ───

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'

// ─── computeTimeline ───

/**
 * Calcule les offsets cumulés des scènes.
 * V1 : concat simple (bout à bout). Pas de crossfade réel.
 * Les startS/endS sont purement logiques et consécutifs.
 */
export function computeTimeline(scenes: SceneMixInput[]): SceneAudioRenderStatus[] {
  const sorted = [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex)

  let cursor = 0
  return sorted.map((scene) => {
    const startS = cursor
    const endS = cursor + scene.durationS
    cursor = endS

    return {
      sceneIndex: scene.sceneIndex,
      startS,
      endS,
      durationS: scene.durationS,
      ttsFilePath: scene.ttsFilePath,
      mixFilePath: scene.mixFilePath,
      status: 'assembled' as const,
      ttsProvider: scene.ttsProvider,
      costEur: scene.costEur,
    }
  })
}

// ─── FFmpeg concat helper ───

function runFfmpegConcat(inputPaths: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const inputs = inputPaths.flatMap((p) => ['-i', p])

    // Build filter_complex: [0:a][1:a]...concat=n=N:v=0:a=1[out]
    const filterInputs = inputPaths.map((_, i) => `[${i}:a]`).join('')
    const filterComplex = `${filterInputs}concat=n=${inputPaths.length}:v=0:a=1[out]`

    const args = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-ar', '44100',
      '-ac', '2',
      '-y', outputPath,
    ]

    const proc = spawn(FFMPEG_BIN, args)

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`FFmpeg concat échoué (code ${code}): ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn échoué: ${err.message}`))
    })
  })
}

// ─── assembleMaster ───

/**
 * Assemble les WAV mixés en un seul master.wav via FFmpeg concat.
 * V1 : concat simple (pas de crossfade réel entre scènes).
 * Écrit le manifest JSON et retourne le AudioMasterManifest.
 */
export async function assembleMaster(params: {
  scenes: SceneMixInput[]
  outputDir: string
  runId: string
}): Promise<AudioMasterManifest> {
  const { scenes, outputDir, runId } = params

  if (scenes.length === 0) {
    throw new Error('Aucune scène audio à assembler')
  }

  const timeline = computeTimeline(scenes)
  const masterPath = join(outputDir, 'master.wav')

  await mkdir(outputDir, { recursive: true })

  if (scenes.length === 1) {
    // Une seule scène : copie directe, pas besoin de FFmpeg
    const sorted = [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex)
    await copyFile(sorted[0].mixFilePath, masterPath)
  } else {
    // N scènes : concat via FFmpeg filter_complex
    const sortedPaths = timeline.map((s) => s.mixFilePath)
    await runFfmpegConcat(sortedPaths, masterPath)
  }

  const totalDurationS = timeline.reduce((sum, s) => sum + s.durationS, 0)
  const totalCostEur = timeline.reduce((sum, s) => sum + s.costEur, 0)

  const manifest: AudioMasterManifest = {
    version: '1.0',
    runId,
    totalDurationS,
    sampleRate: 44100,
    channels: 2,
    masterFilePath: masterPath,
    scenes: timeline,
    qualityChecks: {
      allScenesRendered: true,
      totalCostEur,
    },
    generatedAt: new Date().toISOString(),
  }

  const manifestPath = join(outputDir, 'audio-master-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

  return manifest
}
