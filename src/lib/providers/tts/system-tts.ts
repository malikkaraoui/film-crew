import { mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir, platform } from 'os'
import { spawn } from 'child_process'
import type { TTSProvider, AudioResult, ProviderHealth } from '../types'

// Provider TTS système — utilise les capacités TTS natives de l'OS :
// - macOS : commande `say` (CoreAudio) → AIFF → WAV via ffmpeg
// - Linux : `espeak-ng` si disponible (future extension)
// Nécessite : ffmpeg en PATH (prouvé disponible)

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'
const SYSTEM_TTS_VOICE = process.env.SYSTEM_TTS_VOICE || '' // laisser vide = voix système par défaut

function spawnProcess(bin: string, args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    if (input !== undefined) {
      proc.stdin.write(input)
      proc.stdin.end()
    }
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${bin} exit ${code}: ${stderr.trim()}`))
    })
    proc.on('error', (err) => reject(new Error(`${bin} spawn erreur: ${err.message}`)))
  })
}

async function isBinaryAvailable(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ['--help'])
    proc.on('error', () => resolve(false))
    proc.on('close', () => resolve(true))
    // say ne répond pas à --help mais spawn succeeds
  })
}

async function macOSSynthesize(text: string, voice: string, aiffPath: string): Promise<void> {
  const args = voice ? ['-v', voice, '-o', aiffPath, text] : ['-o', aiffPath, text]
  return spawnProcess('say', args)
}

async function convertAiffToWav(aiffPath: string, wavPath: string): Promise<void> {
  return spawnProcess(FFMPEG_BIN, ['-i', aiffPath, '-y', wavPath])
}

export const systemTtsProvider: TTSProvider = {
  name: 'system-tts',
  type: 'tts',

  async healthCheck(): Promise<ProviderHealth> {
    const os = platform()
    if (os === 'darwin') {
      const sayOk = await isBinaryAvailable('say')
      const ffmpegOk = await isBinaryAvailable(FFMPEG_BIN)
      if (!sayOk) return { status: 'down', lastCheck: new Date().toISOString(), details: '`say` introuvable (macOS CoreAudio TTS)' }
      if (!ffmpegOk) return { status: 'down', lastCheck: new Date().toISOString(), details: `ffmpeg introuvable (${FFMPEG_BIN})` }
      return { status: 'free', lastCheck: new Date().toISOString(), details: 'macOS say + ffmpeg opérationnels' }
    }
    return { status: 'down', lastCheck: new Date().toISOString(), details: `OS non supporté par system-tts : ${os}` }
  },

  estimateCost(): number {
    return 0
  },

  async synthesize(text: string, _voiceId: string, _lang: string, outputDir?: string): Promise<AudioResult> {
    const os = platform()
    if (os !== 'darwin') throw new Error(`system-tts non supporté sur ${os}`)

    const dir = outputDir ?? tmpdir()
    await mkdir(dir, { recursive: true })

    const ts = Date.now()
    const aiffPath = join(tmpdir(), `tts-system-${ts}.aiff`)
    const wavPath = join(dir, `tts-system-${ts}.wav`)

    // 1. Synthèse vocale → AIFF (CoreAudio macOS)
    await macOSSynthesize(text, SYSTEM_TTS_VOICE, aiffPath)

    // 2. Conversion AIFF → WAV via ffmpeg (PCM 16 bit, 22050 Hz)
    await convertAiffToWav(aiffPath, wavPath)

    // 3. Nettoyage du fichier AIFF intermédiaire
    await unlink(aiffPath).catch(() => {}) // silencieux

    const words = text.split(/\s+/).length
    const duration = (words / 150) * 60

    return { filePath: wavPath, duration, costEur: 0 }
  },
}
