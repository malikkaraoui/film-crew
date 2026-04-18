import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { TTSProvider, AudioResult, ProviderHealth } from '../types'

const API_KEY = process.env.FISH_AUDIO_API_KEY || ''
const BASE_URL = 'https://api.fish.audio'

// Voix de référence par langue (IDs de modèles Fish Audio publics)
const VOICE_BY_LANG: Record<string, string> = {
  fr: '54a5170264694bfc8e9ad98df7bd89c3', // voix FR par défaut
  en: '54a5170264694bfc8e9ad98df7bd89c3',
  de: '54a5170264694bfc8e9ad98df7bd89c3',
  pt: '54a5170264694bfc8e9ad98df7bd89c3',
  es: '54a5170264694bfc8e9ad98df7bd89c3',
  it: '54a5170264694bfc8e9ad98df7bd89c3',
}

export const fishAudioProvider: TTSProvider = {
  name: 'fish-audio',
  type: 'tts',

  async healthCheck(): Promise<ProviderHealth> {
    if (!API_KEY) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'FISH_AUDIO_API_KEY manquante' }
    }
    try {
      const res = await fetch(`${BASE_URL}/model`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.status < 500) return { status: 'free', lastCheck: new Date().toISOString() }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'Fish Audio non joignable' }
    }
  },

  estimateCost(): number {
    // Fish Audio ≈ 0.015€/1000 caractères
    return 0.015
  },

  async synthesize(text: string, voiceId: string, lang: string, outputDir?: string): Promise<AudioResult> {
    if (!API_KEY) throw new Error('FISH_AUDIO_API_KEY manquante')

    const referenceId = voiceId !== 'default' ? voiceId : (VOICE_BY_LANG[lang] ?? VOICE_BY_LANG.fr)

    const res = await fetch(`${BASE_URL}/v1/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        reference_id: referenceId,
        format: 'mp3',
        mp3_bitrate: 192,
        latency: 'normal',
        normalize: true,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Fish Audio TTS erreur ${res.status}: ${err}`)
    }

    const buffer = await res.arrayBuffer()
    const dir = outputDir ?? tmpdir()
    await mkdir(dir, { recursive: true })

    const filename = `tts-${Date.now()}.mp3`
    const filePath = join(dir, filename)
    await writeFile(filePath, Buffer.from(buffer))

    // Estimation durée : ~150 mots/min, ~5 chars/mot
    const words = text.split(/\s+/).length
    const duration = (words / 150) * 60

    const costEur = (text.length / 1000) * 0.015

    return { filePath, duration, costEur }
  },
}
