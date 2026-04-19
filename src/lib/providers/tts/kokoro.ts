import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { TTSProvider, AudioResult, ProviderHealth } from '../types'

const KOKORO_URL = process.env.KOKORO_URL || 'http://localhost:8880'
const KOKORO_VOICE = process.env.KOKORO_VOICE || 'af_heart'

export const kokoroProvider: TTSProvider = {
  name: 'kokoro-local',
  type: 'tts',

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${KOKORO_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) return { status: 'free', lastCheck: new Date().toISOString() }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'Kokoro non joignable (serveur local arrêté ?)' }
    }
  },

  estimateCost(): number {
    // Kokoro local — coût infrastructure nul
    return 0
  },

  async synthesize(text: string, voiceId: string, lang: string, outputDir?: string): Promise<AudioResult> {
    const voice = voiceId !== 'default' ? voiceId : KOKORO_VOICE

    const res = await fetch(`${KOKORO_URL}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: text,
        voice,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Kokoro TTS erreur ${res.status}: ${err}`)
    }

    const buffer = await res.arrayBuffer()
    const dir = outputDir ?? tmpdir()
    await mkdir(dir, { recursive: true })

    const filename = `tts-kokoro-${Date.now()}.wav`
    const filePath = join(dir, filename)
    await writeFile(filePath, Buffer.from(buffer))

    // Estimation durée : ~150 mots/min, ~5 chars/mot
    const words = text.split(/\s+/).length
    const duration = (words / 150) * 60

    return { filePath, duration, costEur: 0 }
  },
}
