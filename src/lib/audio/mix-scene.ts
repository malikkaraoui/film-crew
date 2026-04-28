import { spawn } from 'child_process'

// ─── Types ───

export type MixVolumes = {
  dialogue: number
  ambiance: number
  fx: number
  music: number
}

export const DEFAULT_MIX_VOLUMES: MixVolumes = {
  dialogue: 1.0,
  ambiance: 0.3,
  fx: 0.6,
  music: 0.12,
}

export type SceneMixConfig = {
  ttsPath: string
  ambiancePath: string | null
  fxPaths: string[]
  musicPath: string | null
  outputPath: string
  volumes: MixVolumes
  targetDurationS: number
}

export type FFmpegCommand = {
  bin: string
  args: string[]
}

// ─── Helpers ───

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'

/**
 * Build the FFmpeg command to mix a scene's audio layers.
 * Pure function — does not execute anything, making it easy to unit-test.
 */
export function buildSceneMixCommand(config: SceneMixConfig): FFmpegCommand {
  const { ttsPath, ambiancePath, fxPaths, musicPath, outputPath, volumes, targetDurationS } = config

  // Collect optional layers in deterministic order: ambiance, fx[], music
  const hasAmbiance = ambiancePath !== null
  const hasMusic = musicPath !== null
  const hasFx = fxPaths.length > 0
  const layerCount = 1 + (hasAmbiance ? 1 : 0) + fxPaths.length + (hasMusic ? 1 : 0)

  // Dialogue-only: simple copy, no filter_complex
  if (layerCount === 1) {
    return {
      bin: FFMPEG_BIN,
      args: ['-i', ttsPath, '-af', `apad=whole_dur=${targetDurationS}`, '-y', outputPath],
    }
  }

  // Build inputs list and filter_complex
  const inputs: string[] = ['-i', ttsPath]
  const filterParts: string[] = []
  let inputIndex = 1

  // Dialogue volume
  filterParts.push(`[0:a]apad=whole_dur=${targetDurationS},volume=${volumes.dialogue}[dial]`)

  const mixLabels: string[] = ['[dial]']

  // Ambiance (looped)
  if (hasAmbiance) {
    inputs.push('-i', ambiancePath)
    const label = `amb`
    filterParts.push(
      `[${inputIndex}:a]aloop=loop=-1:size=2e+09,atrim=0:${targetDurationS},volume=${volumes.ambiance}[${label}]`,
    )
    mixLabels.push(`[${label}]`)
    inputIndex++
  }

  // FX (no loop)
  for (let i = 0; i < fxPaths.length; i++) {
    inputs.push('-i', fxPaths[i])
    const label = `fx${i}`
    filterParts.push(`[${inputIndex}:a]volume=${volumes.fx}[${label}]`)
    mixLabels.push(`[${label}]`)
    inputIndex++
  }

  // Music (looped)
  if (hasMusic) {
    inputs.push('-i', musicPath)
    const label = `mus`
    filterParts.push(
      `[${inputIndex}:a]aloop=loop=-1:size=2e+09,atrim=0:${targetDurationS},volume=${volumes.music}[${label}]`,
    )
    mixLabels.push(`[${label}]`)
    inputIndex++
  }

  // Merge all layers
  filterParts.push(
    `${mixLabels.join('')}amix=inputs=${layerCount}:duration=longest:dropout_transition=2[out]`,
  )

  const filterComplex = filterParts.join(';')

  return {
    bin: FFMPEG_BIN,
    args: [...inputs, '-filter_complex', filterComplex, '-map', '[out]', '-y', outputPath],
  }
}

// ─── Execution ───

/**
 * Execute the scene mix via FFmpeg spawn.
 * Resolves on success, rejects with stderr on failure.
 */
export function mixScene(config: SceneMixConfig): Promise<void> {
  const cmd = buildSceneMixCommand(config)

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd.bin, cmd.args)

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg mix failed (code ${code}): ${stderr}`))
    })

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`))
    })
  })
}
