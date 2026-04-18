import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoProvider, VideoOpts, VideoResult, ProviderHealth } from '../types'

// BytePlus ARK — Seedance video generation
// API: https://ark.ap-southeast.bytepluses.com/api/v3/
// Modèle: seedance-1-lite ou l'endpoint ID créé dans la console BytePlus ARK
const API_KEY = process.env.SEEDANCE_API_KEY || ''
const MODEL_ID = process.env.SEEDANCE_MODEL_ID || 'seedance-1-lite'
const BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3'
const POLL_INTERVAL_MS = 8000
const MAX_POLLS = 75 // 10 minutes max

export const seedanceProvider: VideoProvider = {
  name: 'seedance',
  type: 'video',

  async healthCheck(): Promise<ProviderHealth> {
    if (!API_KEY) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'SEEDANCE_API_KEY manquante' }
    }
    try {
      const res = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.status < 500) return { status: 'free', lastCheck: new Date().toISOString() }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'Seedance non joignable' }
    }
  },

  estimateCost(opts: unknown): number {
    const o = opts as VideoOpts
    const duration = o?.duration ?? 10
    // Seedance 10s 720p ≈ 0.80€ (estimation BytePlus ARK tarifs)
    return (duration / 10) * 0.80
  },

  async generate(prompt: string, opts: VideoOpts): Promise<VideoResult> {
    if (!API_KEY) throw new Error('SEEDANCE_API_KEY manquante')

    const duration = opts.duration ?? 10
    const resolution = opts.resolution ?? '720p'
    const aspectRatio = opts.aspectRatio ?? '9:16'

    // Créer la tâche de génération
    const genRes = await fetch(`${BASE_URL}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        content: [{ type: 'text', text: prompt }],
        parameters: {
          resolution,
          duration,
          aspect_ratio: aspectRatio,
          ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        },
      }),
    })

    if (!genRes.ok) {
      const err = await genRes.json().catch(() => ({}))
      throw new Error(`Seedance generate erreur ${genRes.status}: ${JSON.stringify(err)}`)
    }

    const genData = await genRes.json()
    const taskId: string = genData.id ?? genData.task_id
    if (!taskId) throw new Error('Seedance: task_id manquant')

    // Polling
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

      const statusRes = await fetch(`${BASE_URL}/contents/generations/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })

      if (!statusRes.ok) continue

      const statusData = await statusRes.json()
      const status: string = statusData.status

      if (status === 'succeeded' || status === 'SUCCESS' || status === 'completed') {
        const videoUrl: string =
          statusData.output?.url ??
          statusData.content?.[0]?.url ??
          statusData.result?.url

        if (!videoUrl) throw new Error('Seedance: URL vidéo manquante')

        const costEur = (duration / 10) * 0.80

        const outputDir = opts.outputDir ?? tmpdir()
        await mkdir(outputDir, { recursive: true })
        const filePath = join(outputDir, `seedance-${taskId}.mp4`)

        const dlRes = await fetch(videoUrl)
        if (!dlRes.ok) throw new Error(`Échec téléchargement vidéo Seedance: ${dlRes.status}`)
        const buffer = await dlRes.arrayBuffer()
        await writeFile(filePath, Buffer.from(buffer))

        return { filePath, duration, costEur, seed: opts.seed }
      }

      if (status === 'failed' || status === 'error') {
        const msg = statusData.error?.message ?? statusData.message ?? 'Génération échouée'
        throw new Error(`Seedance tâche échouée: ${msg}`)
      }
    }

    throw new Error(`Seedance: timeout après ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`)
  },

  async cancel(jobId: string): Promise<void> {
    if (!API_KEY) return
    await fetch(`${BASE_URL}/contents/generations/tasks/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
    }).catch(() => undefined)
  },
}
