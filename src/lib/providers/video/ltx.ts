import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoProvider, VideoOpts, VideoResult, ProviderHealth } from '../types'

// LTX Video Cloud API — https://api.ltx.video
// API synchrone : retourne le binaire MP4 directement (pas de polling)
// Clé : console.ltx.video → format ltxv_...
const API_KEY = process.env.LTX_API_KEY || ''
const BASE_URL = 'https://api.ltx.video'

function resolutionForAspectRatio(aspectRatio: string, resolution: string): string {
  // LTX accepte des résolutions comme "1280x720", "720x1280", "1920x1080" etc.
  const [w, h] = (() => {
    if (resolution === '1080p') return aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080]
    if (resolution === '480p') return aspectRatio === '9:16' ? [480, 848] : [848, 480]
    // 720p default
    return aspectRatio === '9:16' ? [720, 1280] : [1280, 720]
  })()
  return `${w}x${h}`
}

export const ltxProvider: VideoProvider = {
  name: 'ltx',
  type: 'video',

  async healthCheck(): Promise<ProviderHealth> {
    if (!API_KEY) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'LTX_API_KEY manquante — voir console.ltx.video' }
    }
    try {
      // Test avec une requête minimale invalide pour vérifier l'auth
      const res = await fetch(`${BASE_URL}/v1/text-to-video`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: '', model: 'ltx-2-3-fast', duration: 0, resolution: '720x1280' }),
        signal: AbortSignal.timeout(5000),
      })
      // 400/422 = API accessible, auth OK
      if (res.status === 400 || res.status === 422) return { status: 'free', lastCheck: new Date().toISOString() }
      if (res.status === 401) return { status: 'down', lastCheck: new Date().toISOString(), details: 'Clé API invalide' }
      if (res.ok) return { status: 'free', lastCheck: new Date().toISOString() }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'LTX API non joignable' }
    }
  },

  estimateCost(opts: unknown): number {
    const o = opts as VideoOpts
    const duration = o?.duration ?? 5
    // LTX-2.3-pro ≈ 0.05$/s → 0.046€/s
    return duration * 0.046
  },

  async generate(prompt: string, opts: VideoOpts): Promise<VideoResult> {
    if (!API_KEY) throw new Error('LTX_API_KEY manquante — voir console.ltx.video')

    const duration = Math.min(Math.max(Math.round(opts.duration ?? 5), 1), 30)
    const resolution = resolutionForAspectRatio(opts.aspectRatio ?? '9:16', opts.resolution ?? '720p')

    const res = await fetch(`${BASE_URL}/v1/text-to-video`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        model: 'ltx-2-3-fast',
        duration,
        resolution,
        fps: 24,
        generate_audio: false, // TTS géré séparément par Fish Audio
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`LTX erreur ${res.status}: ${err}`)
    }

    // Réponse directe = binaire MP4
    const buffer = await res.arrayBuffer()
    const costEur = duration * 0.046

    const outputDir = opts.outputDir ?? tmpdir()
    await mkdir(outputDir, { recursive: true })
    const filename = `ltx-${Date.now()}.mp4`
    const filePath = join(outputDir, filename)
    await writeFile(filePath, Buffer.from(buffer))

    return { filePath, duration, costEur, seed: opts.seed }
  },

  async cancel(_jobId: string): Promise<void> {
    // API synchrone — pas d'annulation possible
  },
}
