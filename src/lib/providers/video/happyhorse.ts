import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoProvider, VideoOpts, VideoResult, ProviderHealth } from '../types'

const API_KEY = process.env.HAPPYHORSE_API_KEY || ''
const BASE_URL = 'https://happyhorse.app'
const POLL_INTERVAL_MS = 5000
const MAX_POLLS = 60 // 5 minutes max

export const happyhorseProvider: VideoProvider = {
  name: 'happyhorse',
  type: 'video',

  async healthCheck(): Promise<ProviderHealth> {
    if (!API_KEY) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'HAPPYHORSE_API_KEY manquante' }
    }
    try {
      const res = await fetch(`${BASE_URL}/api/status?task_id=ping`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
      // 404 ou 400 = API accessible mais tâche inconnue → OK
      if (res.status < 500) return { status: 'free', lastCheck: new Date().toISOString() }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'HappyHorse non joignable' }
    }
  },

  estimateCost(opts: unknown): number {
    const o = opts as VideoOpts
    const duration = o?.duration ?? 5
    // pro mode: 80 crédits/s avec audio ≈ 0.008€/crédit (estimation)
    return duration * 80 * 0.00008
  },

  async generate(prompt: string, opts: VideoOpts): Promise<VideoResult> {
    if (!API_KEY) throw new Error('HAPPYHORSE_API_KEY manquante')

    const duration = opts.duration ?? 5
    const aspectRatio = opts.aspectRatio ?? '9:16'

    // Lancer la génération
    const genRes = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'happyhorse-1.0/video',
        prompt,
        mode: 'pro',
        duration,
        aspect_ratio: aspectRatio,
        sound: false, // on gère le TTS séparément
        cfg_scale: 0.5,
      }),
    })

    if (!genRes.ok) {
      const err = await genRes.json().catch(() => ({}))
      throw new Error(`HappyHorse generate erreur ${genRes.status}: ${JSON.stringify(err)}`)
    }

    const genData = await genRes.json()
    const taskId: string = genData.data?.task_id
    if (!taskId) throw new Error('HappyHorse: task_id manquant dans la réponse')

    // Polling jusqu'à SUCCESS
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

      const statusRes = await fetch(`${BASE_URL}/api/status?task_id=${taskId}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })

      if (!statusRes.ok) continue

      const statusData = await statusRes.json()
      const status: string = statusData.data?.status

      if (status === 'SUCCESS') {
        const videoUrl: string = statusData.data?.response?.resultUrls?.[0]
        if (!videoUrl) throw new Error('HappyHorse: URL vidéo manquante dans la réponse')

        const creditsUsed: number = statusData.data?.consumed_credits ?? duration * 80
        const costEur = creditsUsed * 0.00008

        // Télécharger la vidéo localement
        const outputDir = opts.outputDir ?? tmpdir()
        await mkdir(outputDir, { recursive: true })
        const filePath = join(outputDir, `happyhorse-${taskId}.mp4`)

        const dlRes = await fetch(videoUrl)
        if (!dlRes.ok) throw new Error(`Échec téléchargement vidéo: ${dlRes.status}`)
        const buffer = await dlRes.arrayBuffer()
        await writeFile(filePath, Buffer.from(buffer))

        return { filePath, duration, costEur }
      }

      if (status === 'FAILED') {
        const msg = statusData.data?.error_message ?? 'Génération échouée'
        throw new Error(`HappyHorse tâche échouée: ${msg}`)
      }
      // IN_PROGRESS → continuer à poller
    }

    throw new Error(`HappyHorse: timeout après ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`)
  },

  async cancel(_jobId: string): Promise<void> {
    // HappyHorse ne supporte pas l'annulation de tâche via API
  },
}
