import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ImageProvider, ImageOpts, ImageResult, ProviderHealth } from '../types'

// FAL.ai — FLUX.1 image generation
// Queue API: https://queue.fal.run/{model_id}
// Auth: Authorization: Key {FAL_API_KEY}
const API_KEY = process.env.FAL_API_KEY || ''
const QUEUE_BASE = 'https://queue.fal.run'
const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 60

type FalImageSize = 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9'

function imageSizeFromOpts(opts: ImageOpts): FalImageSize {
  const w = opts.width ?? 768
  const h = opts.height ?? 1344
  const ratio = w / h
  if (ratio < 0.7) return 'portrait_16_9'   // 9:16
  if (ratio < 0.85) return 'portrait_4_3'
  if (ratio > 1.5) return 'landscape_16_9'
  if (ratio > 1.15) return 'landscape_4_3'
  return 'square_hd'
}

async function falQueue(modelId: string, input: Record<string, unknown>): Promise<unknown> {
  // Soumettre la tâche
  const submitRes = await fetch(`${QUEUE_BASE}/${modelId}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`FAL submit erreur ${submitRes.status}: ${err}`)
  }
  const submitData = await submitRes.json() as { request_id: string; status?: string }
  const requestId = submitData.request_id
  if (!requestId) throw new Error('FAL: request_id manquant')

  // Polling
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const statusRes = await fetch(`${QUEUE_BASE}/${modelId}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${API_KEY}` },
    })
    if (!statusRes.ok) continue

    const statusData = await statusRes.json() as { status: string; error?: string }

    if (statusData.status === 'COMPLETED') {
      const resultRes = await fetch(`${QUEUE_BASE}/${modelId}/requests/${requestId}`, {
        headers: { Authorization: `Key ${API_KEY}` },
      })
      if (!resultRes.ok) throw new Error(`FAL result erreur: ${resultRes.status}`)
      return resultRes.json()
    }

    if (statusData.status === 'FAILED') {
      throw new Error(`FAL tâche échouée: ${statusData.error ?? 'erreur inconnue'}`)
    }
  }

  throw new Error(`FAL: timeout après ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`)
}

export const falImageProvider: ImageProvider = {
  name: 'fal-flux',
  type: 'image',

  async healthCheck(): Promise<ProviderHealth> {
    if (!API_KEY) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'FAL_API_KEY manquante' }
    }
    try {
      const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: {
          Authorization: `Key ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: '', num_images: 0 }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.status < 500) return { status: 'free', lastCheck: new Date().toISOString() }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'FAL non joignable' }
    }
  },

  estimateCost(): number {
    // FLUX.1-schnell ≈ 0.003$/image ≈ 0.0028€
    return 0.003
  },

  async generate(prompt: string, opts: ImageOpts): Promise<ImageResult> {
    if (!API_KEY) throw new Error('FAL_API_KEY manquante')

    const imageSize = imageSizeFromOpts(opts)

    const result = await falQueue('fal-ai/flux/schnell', {
      prompt,
      image_size: imageSize,
      num_images: 1,
      num_inference_steps: 4,
      enable_safety_checker: false,
    }) as { images: { url: string }[] }

    const imageUrl = result?.images?.[0]?.url
    if (!imageUrl) throw new Error('FAL: URL image manquante dans la réponse')

    // Télécharger l'image
    const outputDir = opts.outputDir ?? tmpdir()
    await mkdir(outputDir, { recursive: true })
    const filename = `fal-${Date.now()}.png`
    const filePath = join(outputDir, filename)

    const dlRes = await fetch(imageUrl)
    if (!dlRes.ok) throw new Error(`Échec téléchargement image FAL: ${dlRes.status}`)
    const buffer = await dlRes.arrayBuffer()
    await writeFile(filePath, Buffer.from(buffer))

    return { filePath, costEur: 0.003 }
  },
}
