import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoProvider, VideoOpts, VideoResult, ProviderHealth } from '../types'

const API_KEY = process.env.HAPPYHORSE_API_KEY || ''
export const HAPPYHORSE_BASE_URL = 'https://happyhorse.app'
export const HAPPYHORSE_GENERATE_PATH = '/api/generate'
export const HAPPYHORSE_MODEL = 'happyhorse-1.0/video'
export const HAPPYHORSE_DEFAULT_MODE = 'std'
export const HAPPYHORSE_DEFAULT_SOUND = false
export const HAPPYHORSE_DEFAULT_CFG_SCALE = 0.5
const POLL_INTERVAL_MS = 5000
const MAX_POLLS = 60 // 5 minutes max

export function buildHappyHorseRequestBody(prompt: string, opts: VideoOpts): Record<string, unknown> {
  const duration = opts.duration ?? 5
  const aspectRatio = opts.aspectRatio ?? '9:16'
  const referenceImageUrls = (opts.referenceImageUrls ?? []).filter(Boolean).slice(0, 2)

  return {
    model: HAPPYHORSE_MODEL,
    prompt,
    mode: HAPPYHORSE_DEFAULT_MODE,
    duration,
    aspect_ratio: aspectRatio,
    ...(referenceImageUrls.length > 0 ? { image_urls: referenceImageUrls } : {}),
    sound: HAPPYHORSE_DEFAULT_SOUND,
    cfg_scale: HAPPYHORSE_DEFAULT_CFG_SCALE,
  }
}

export function getHappyHorseSettingOptions(): Array<{ key: string; available: string[]; selected: string }> {
  return [
    { key: 'model', available: [HAPPYHORSE_MODEL], selected: HAPPYHORSE_MODEL },
    { key: 'mode', available: [HAPPYHORSE_DEFAULT_MODE], selected: HAPPYHORSE_DEFAULT_MODE },
    { key: 'duration', available: ['variable (valeur pipeline)'], selected: 'variable (selon la scène)' },
    { key: 'aspect_ratio', available: ['variable (valeur pipeline)'], selected: 'variable (selon le run)' },
    { key: 'image_urls', available: ['0 à 2 URLs image'], selected: 'variable (selon le projet)' },
    { key: 'sound', available: [String(HAPPYHORSE_DEFAULT_SOUND)], selected: String(HAPPYHORSE_DEFAULT_SOUND) },
    { key: 'cfg_scale', available: [String(HAPPYHORSE_DEFAULT_CFG_SCALE)], selected: String(HAPPYHORSE_DEFAULT_CFG_SCALE) },
    { key: 'negative_prompt', available: ['non supporté par l’envoi actuel'], selected: 'non envoyé' },
  ]
}

export const happyhorseProvider: VideoProvider = {
  name: 'happyhorse',
  type: 'video',

  async healthCheck(): Promise<ProviderHealth> {
    if (!API_KEY) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'HAPPYHORSE_API_KEY manquante' }
    }
    try {
      const res = await fetch(`${HAPPYHORSE_BASE_URL}/api/balance`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
      // 200 = API accessible et auth OK
      if (res.ok) return { status: 'free', lastCheck: new Date().toISOString() }
      // 401/403 = clé invalide
      if (res.status === 401 || res.status === 403) {
        return { status: 'down', lastCheck: new Date().toISOString(), details: `Auth échouée: HTTP ${res.status}` }
      }
      // Autre erreur non fatale
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'HappyHorse non joignable' }
    }
  },

  estimateCost(opts: unknown): number {
    const o = opts as VideoOpts
    const duration = o?.duration ?? 5
    // std mode: 40 crédits/s (400 crédits pour 10s)
    return duration * 40 * 0.00008
  },

  async generate(prompt: string, opts: VideoOpts): Promise<VideoResult> {
    if (!API_KEY) throw new Error('HAPPYHORSE_API_KEY manquante')

    const duration = opts.duration ?? 5
    const requestBody = buildHappyHorseRequestBody(prompt, opts)

    // Lancer la génération
    const genRes = await fetch(`${HAPPYHORSE_BASE_URL}${HAPPYHORSE_GENERATE_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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

      const statusRes = await fetch(`${HAPPYHORSE_BASE_URL}/api/status?task_id=${taskId}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })

      if (!statusRes.ok) continue

      const statusData = await statusRes.json()
      const status: string = statusData.data?.status

      if (status === 'SUCCESS') {
        const videoUrl: string = statusData.data?.response?.resultUrls?.[0]
        if (!videoUrl) throw new Error('HappyHorse: URL vidéo manquante dans la réponse')

        const creditsUsed: number = statusData.data?.consumed_credits ?? duration * 40
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
