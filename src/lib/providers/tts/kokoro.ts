import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { TTSProvider, AudioResult, ProviderHealth } from '../types'
import { logger } from '@/lib/logger'

const KOKORO_URL = process.env.KOKORO_URL || 'http://localhost:8880'
const KOKORO_VOICE = process.env.KOKORO_VOICE || 'af_heart'
const KOKORO_TIMEOUT_MS = 60_000
const KOKORO_HEALTH_TIMEOUT_MS = 3_000

/**
 * Lit la durée réelle d'un fichier WAV depuis son header RIFF.
 * WAV PCM : durée = (dataSize) / (sampleRate * numChannels * bitsPerSample/8)
 * Retourne null si le header est invalide ou non-PCM.
 */
export function readWavDurationFromBuffer(buf: Buffer): number | null {
  // Minimum WAV header = 44 bytes
  if (buf.length < 44) return null

  // Vérifier RIFF + WAVE
  const riff = buf.toString('ascii', 0, 4)
  const wave = buf.toString('ascii', 8, 12)
  if (riff !== 'RIFF' || wave !== 'WAVE') return null

  // Chercher le chunk 'fmt ' et 'data'
  let offset = 12
  let sampleRate = 0
  let numChannels = 0
  let bitsPerSample = 0
  let dataSize = 0

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)

    if (chunkId === 'fmt ' && offset + 24 <= buf.length) {
      numChannels = buf.readUInt16LE(offset + 10)
      sampleRate = buf.readUInt32LE(offset + 12)
      bitsPerSample = buf.readUInt16LE(offset + 22)
    } else if (chunkId === 'data') {
      dataSize = chunkSize
      break // data est le dernier chunk qu'on cherche
    }

    offset += 8 + chunkSize
    // Aligner sur 16 bits (padding)
    if (chunkSize % 2 !== 0) offset += 1
  }

  if (sampleRate === 0 || numChannels === 0 || bitsPerSample === 0 || dataSize === 0) {
    return null
  }

  const bytesPerSample = bitsPerSample / 8
  const totalSamples = dataSize / (numChannels * bytesPerSample)
  return totalSamples / sampleRate
}

export const kokoroProvider: TTSProvider = {
  name: 'kokoro-local',
  type: 'tts',

  async healthCheck(): Promise<ProviderHealth> {
    const now = new Date().toISOString()
    try {
      const res = await fetch(`${KOKORO_URL}/health`, {
        signal: AbortSignal.timeout(KOKORO_HEALTH_TIMEOUT_MS),
      })
      if (res.ok) return { status: 'free', lastCheck: now }
      return { status: 'degraded', lastCheck: now, details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: now, details: `Kokoro non joignable sur ${KOKORO_URL}` }
    }
  },

  estimateCost(): number {
    return 0
  },

  async synthesize(text: string, voiceId: string, _lang: string, outputDir?: string): Promise<AudioResult> {
    const voice = voiceId !== 'default' ? voiceId : KOKORO_VOICE
    const startMs = Date.now()

    const res = await fetch(`${KOKORO_URL}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: text,
        voice,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(KOKORO_TIMEOUT_MS),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '(pas de body)')
      throw new Error(`Kokoro TTS erreur ${res.status}: ${err}`)
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    const dir = outputDir ?? tmpdir()
    await mkdir(dir, { recursive: true })

    const filename = `tts-kokoro-${Date.now()}.wav`
    const filePath = join(dir, filename)
    await writeFile(filePath, buffer)

    // Durée réelle depuis le WAV header, fallback sur estimation
    const realDuration = readWavDurationFromBuffer(buffer)
    const estimatedDuration = (text.split(/\s+/).length / 150) * 60
    const duration = realDuration ?? estimatedDuration

    const latencyMs = Date.now() - startMs

    logger.info({
      event: 'kokoro_synthesize',
      voice,
      textLength: text.length,
      durationS: Number(duration.toFixed(2)),
      durationSource: realDuration !== null ? 'wav_header' : 'estimated',
      fileSizeKb: Math.round(buffer.length / 1024),
      latencyMs,
    })

    return { filePath, duration, costEur: 0 }
  },
}
