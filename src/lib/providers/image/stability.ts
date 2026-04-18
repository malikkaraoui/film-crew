import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ImageProvider, ImageOpts, ImageResult, ProviderHealth } from '../types'

const API_KEY = process.env.STABILITY_API_KEY || ''
const BASE_URL = 'https://api.stability.ai'

export const stabilityProvider: ImageProvider = {
  name: 'stability',
  type: 'image',

  async healthCheck(): Promise<ProviderHealth> {
    if (!API_KEY) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'STABILITY_API_KEY manquante' }
    }
    try {
      const res = await fetch(`${BASE_URL}/v1/user/account`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) return { status: 'free', lastCheck: new Date().toISOString() }
      if (res.status === 401) return { status: 'down', lastCheck: new Date().toISOString(), details: 'Clé API invalide' }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'Stability AI non joignable' }
    }
  },

  estimateCost(): number {
    // Stability AI Core ≈ 0.03$ par image ≈ 0.028€
    return 0.028
  },

  async generate(prompt: string, opts: ImageOpts): Promise<ImageResult> {
    if (!API_KEY) throw new Error('STABILITY_API_KEY manquante')

    const width = opts.width ?? 768
    const height = opts.height ?? 1344

    // Déterminer aspect_ratio depuis width/height
    const ratio = width / height
    let aspectRatio = '9:16'
    if (ratio > 1.5) aspectRatio = '16:9'
    else if (ratio > 0.9 && ratio < 1.1) aspectRatio = '1:1'
    else if (ratio < 0.75) aspectRatio = '9:16'
    else aspectRatio = '2:3'

    const formData = new FormData()
    formData.append('prompt', prompt)
    formData.append('aspect_ratio', aspectRatio)
    formData.append('output_format', 'png')
    formData.append('style_preset', opts.style === 'cinematic' ? 'cinematic' : 'photographic')

    const res = await fetch(`${BASE_URL}/v2beta/stable-image/generate/core`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'image/*',
      },
      body: formData,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Stability AI erreur ${res.status}: ${err}`)
    }

    const buffer = await res.arrayBuffer()
    const outputDir = opts.outputDir ?? tmpdir()
    await mkdir(outputDir, { recursive: true })

    const filename = `stability-${Date.now()}.png`
    const filePath = join(outputDir, filename)
    await writeFile(filePath, Buffer.from(buffer))

    return { filePath, costEur: 0.028 }
  },
}
