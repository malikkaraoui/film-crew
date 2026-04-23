import { spawn } from 'child_process'

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe'

export type H264Encoder = 'h264_videotoolbox' | 'h264_nvenc' | 'h264_qsv' | 'libx264'

// ─── Détection encodeur ──────────────────────────────────────────────────────

/** Teste si un encodeur est réellement exploitable (smoke test 1 frame). */
async function smokeTestEncoder(encoder: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.04',
      '-frames:v', '1',
      '-c:v', encoder,
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'ignore'] })
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
}

let _cachedEncoder: H264Encoder | null = null

/**
 * Détecte le meilleur encodeur H.264 exploitable.
 * Ordre : VideoToolbox (macOS) → NVENC (NVIDIA) → QSV (Intel) → libx264.
 * Résultat mis en cache. Override via PREVIEW_ENCODER env.
 */
export async function detectEncoder(): Promise<H264Encoder> {
  if (_cachedEncoder) return _cachedEncoder

  // Override manuel
  const override = process.env.PREVIEW_ENCODER as H264Encoder | undefined
  if (override && ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'libx264'].includes(override)) {
    if (override === 'libx264' || await smokeTestEncoder(override)) {
      _cachedEncoder = override
      return override
    }
  }

  const candidates: H264Encoder[] = ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv']
  for (const enc of candidates) {
    if (await smokeTestEncoder(enc)) {
      _cachedEncoder = enc
      return enc
    }
  }

  _cachedEncoder = 'libx264'
  return 'libx264'
}

/** Permet de reset le cache (pour les tests). */
export function _resetEncoderCache(): void {
  _cachedEncoder = null
}

// ─── Arguments par encodeur ──────────────────────────────────────────────────

/** Retourne les arguments FFmpeg adaptés à chaque encodeur. Pas de CRF universel. */
export function encoderArgs(enc: H264Encoder): string[] {
  switch (enc) {
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', '-q:v', '65']
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-cq', '28', '-preset', 'p4']
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-global_quality', '28']
    case 'libx264':
      return ['-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-pix_fmt', 'yuv420p']
  }
}

// ─── Probe durée média ───────────────────────────────────────────────────────

/**
 * Retourne la durée (secondes) d'un fichier média via ffprobe -show_format.
 * Fonctionne sur audio ET vidéo. Retourne fallback si ffprobe échoue.
 */
export async function probeMediaDuration(filePath: string, fallback = 10): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE_BIN, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] })

    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', () => {
      try {
        const json = JSON.parse(out)
        const duration = parseFloat(json.format?.duration ?? '0')
        resolve(duration > 0 ? duration : fallback)
      } catch {
        resolve(fallback)
      }
    })
    proc.on('error', () => resolve(fallback))
  })
}

// ─── Vérification libass ─────────────────────────────────────────────────────

let _libassCache: boolean | null = null

/** Vérifie si FFmpeg a le filtre subtitles (libass). Résultat mis en cache. */
export async function checkLibass(): Promise<boolean> {
  if (_libassCache !== null) return _libassCache

  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_BIN, ['-hide_banner', '-filters'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', () => {
      _libassCache = out.includes('subtitles')
      resolve(_libassCache)
    })
    proc.on('error', () => {
      _libassCache = false
      resolve(false)
    })
  })
}

/** Reset cache libass (pour les tests). */
export function _resetLibassCache(): void {
  _libassCache = null
}

// ─── Normalisation clip ──────────────────────────────────────────────────────

/**
 * Normalise un clip vers un format de travail commun pour xfade :
 * libx264 + yuv420p + 30fps + 1080x1920 + setsar=1
 */
export async function normalizeClip(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, [
      '-i', input,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
      '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2',
      '-y', output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })

    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`normalizeClip failed (exit ${code}): ${stderr.slice(-300)}`))
    })
    proc.on('error', (err) => reject(new Error(`normalizeClip spawn: ${err.message}`)))
  })
}
