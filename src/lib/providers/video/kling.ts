import { createHmac } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoProvider, VideoOpts, VideoResult, ProviderHealth } from '../types'

const ACCESS_KEY = process.env.KLING_ACCESS_KEY || ''
const SECRET_KEY = process.env.KLING_SECRET_KEY || ''
const BASE_URL = 'https://api.klingai.com'
const POLL_INTERVAL_MS = 6000
const MAX_POLLS = 60

function generateJWT(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: ACCESS_KEY,
    exp: now + 1800,
    nbf: now - 5,
  })).toString('base64url')
  const signature = createHmac('sha256', SECRET_KEY)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

export const klingProvider: VideoProvider = {
  name: 'kling',
  type: 'video',

  async healthCheck(): Promise<ProviderHealth> {
    if (!ACCESS_KEY || !SECRET_KEY) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'KLING_ACCESS_KEY ou KLING_SECRET_KEY manquante' }
    }
    try {
      const token = generateJWT()
      const res = await fetch(`${BASE_URL}/v1/videos/text2video`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.status < 500) return { status: 'free', lastCheck: new Date().toISOString() }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'Kling non joignable' }
    }
  },

  estimateCost(opts: unknown): number {
    const o = opts as VideoOpts
    const duration = o?.duration ?? 5
    // Kling pro 10s ≈ 0.50€ estimé
    return (duration / 10) * 0.50
  },

  async generate(prompt: string, opts: VideoOpts): Promise<VideoResult> {
    if (!ACCESS_KEY || !SECRET_KEY) throw new Error('Clés Kling manquantes')

    const duration = opts.duration ?? 5
    const aspectRatio = opts.aspectRatio ?? '9:16'
    const klingDuration = duration <= 5 ? '5' : '10'

    const token = generateJWT()

    // Lancer la génération
    const genRes = await fetch(`${BASE_URL}/v1/videos/text2video`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'kling-v1',
        prompt,
        mode: 'pro',
        duration: klingDuration,
        aspect_ratio: aspectRatio,
        cfg_scale: 0.5,
      }),
    })

    if (!genRes.ok) {
      const err = await genRes.json().catch(() => ({}))
      throw new Error(`Kling generate erreur ${genRes.status}: ${JSON.stringify(err)}`)
    }

    const genData = await genRes.json()
    if (genData.code !== 0) throw new Error(`Kling erreur: ${genData.message}`)
    const taskId: string = genData.data?.task_id
    if (!taskId) throw new Error('Kling: task_id manquant')

    // Polling
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

      const newToken = generateJWT()
      const statusRes = await fetch(`${BASE_URL}/v1/videos/text2video/${taskId}`, {
        headers: { Authorization: `Bearer ${newToken}` },
      })

      if (!statusRes.ok) continue

      const statusData = await statusRes.json()
      if (statusData.code !== 0) continue

      const taskStatus: string = statusData.data?.task_status

      if (taskStatus === 'succeed') {
        const videoUrl: string = statusData.data?.task_result?.videos?.[0]?.url
        if (!videoUrl) throw new Error('Kling: URL vidéo manquante')

        const actualDuration = parseFloat(statusData.data?.task_result?.videos?.[0]?.duration ?? klingDuration)
        const costEur = (actualDuration / 10) * 0.50

        const outputDir = opts.outputDir ?? tmpdir()
        await mkdir(outputDir, { recursive: true })
        const filePath = join(outputDir, `kling-${taskId}.mp4`)

        const dlRes = await fetch(videoUrl)
        if (!dlRes.ok) throw new Error(`Échec téléchargement vidéo Kling: ${dlRes.status}`)
        const buffer = await dlRes.arrayBuffer()
        await writeFile(filePath, Buffer.from(buffer))

        return { filePath, duration: actualDuration, costEur }
      }

      if (taskStatus === 'failed') {
        throw new Error(`Kling tâche échouée: ${statusData.data?.task_status_msg ?? ''}`)
      }
    }

    throw new Error(`Kling: timeout après ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`)
  },

  async cancel(_jobId: string): Promise<void> {
    // Kling ne supporte pas l'annulation via API
  },
}
