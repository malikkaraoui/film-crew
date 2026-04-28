import { NextRequest, NextResponse } from 'next/server'
import {
  getAvailableCloudLlmModels,
  getAvailableOpenRouterLlmModels,
  isCloudLlmReachable,
  isOpenRouterLlmReachable,
} from '@/lib/llm/target'
import type { LlmCatalogModelDetail, LlmCatalogProvider } from '@/lib/llm/catalog'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const OPENROUTER_CACHE_TTL_MS = 5 * 60 * 1000

let openRouterCache:
  | {
      cachedAt: number
      payload: {
        openRouterModels: string[]
        openRouterModelDetails: LlmCatalogModelDetail[]
        openRouterError: string | null
      }
    }
  | null = null

function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatContextLength(contextLength: number | null | undefined): string | null {
  if (!contextLength || !Number.isFinite(contextLength) || contextLength <= 0) return null
  if (contextLength >= 1000) {
    const value = contextLength / 1000
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}k ctx`
  }
  return `${contextLength} ctx`
}

function isFreePrice(value: string | null | undefined): boolean {
  if (!value) return true
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed === 0
}

function buildCloudModelDetails(): LlmCatalogModelDetail[] {
  return getAvailableCloudLlmModels().map((model) => ({
    id: model,
    label: model,
    description: model.includes('-cloud') ? 'Modèle cloud configuré côté runtime' : 'Modèle cloud déclaré dans la config',
  }))
}

function buildFallbackOpenRouterModelDetails(): LlmCatalogModelDetail[] {
  return getAvailableOpenRouterLlmModels().map((model) => ({
    id: model,
    label: model,
    description: 'Fallback statique OpenRouter (API listing indisponible)',
  }))
}

async function getLocalModels(): Promise<{
  localModels: string[]
  localModelDetails: LlmCatalogModelDetail[]
  localError: string | null
}> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      return {
        localModels: [],
        localModelDetails: [],
        localError: `Ollama HTTP ${res.status}`,
      }
    }

    const data = await res.json()
    const details: LlmCatalogModelDetail[] = (data.models ?? []).map((entry: {
      name: string
      size?: number
      modified_at?: string
      details?: {
        parameter_size?: string
        quantization_level?: string
        family?: string
      }
    }) => {
      const parts = [entry.name]
      if (entry.details?.parameter_size) parts.push(entry.details.parameter_size)
      if (entry.details?.quantization_level) parts.push(entry.details.quantization_level)
      if (entry.size) {
        const formatted = formatBytes(entry.size)
        if (formatted) parts.push(formatted)
      }

      const descriptionParts = [
        entry.details?.family,
        entry.modified_at ? `maj ${new Date(entry.modified_at).toLocaleString('fr-FR')}` : null,
      ].filter(Boolean)

      return {
        id: entry.name,
        label: parts.join(' · '),
        description: descriptionParts.join(' · ') || undefined,
      }
    })

    return {
      localModels: details.map((detail) => detail.id),
      localModelDetails: details,
      localError: null,
    }
  } catch {
    return {
      localModels: [],
      localModelDetails: [],
      localError: 'Ollama non joignable',
    }
  }
}

async function getOpenRouterModels(force = false): Promise<{
  openRouterModels: string[]
  openRouterModelDetails: LlmCatalogModelDetail[]
  openRouterError: string | null
}> {
  if (!force && openRouterCache && Date.now() - openRouterCache.cachedAt < OPENROUTER_CACHE_TTL_MS) {
    return openRouterCache.payload
  }

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(7000) })
    if (!res.ok) {
      const fallback = {
        openRouterModels: getAvailableOpenRouterLlmModels(),
        openRouterModelDetails: buildFallbackOpenRouterModelDetails(),
        openRouterError: `OpenRouter HTTP ${res.status}`,
      }
      openRouterCache = { cachedAt: Date.now(), payload: fallback }
      return fallback
    }

    const data = await res.json()
    const details: LlmCatalogModelDetail[] = (data.data ?? [])
      .filter((model: {
        id: string
        context_length?: number
        description?: string
        pricing?: Record<string, string>
        architecture?: { output_modalities?: string[] }
      }) => {
        const outputModalities = model.architecture?.output_modalities ?? ['text']
        if (!outputModalities.includes('text')) return false

        return isFreePrice(model.pricing?.prompt)
          && isFreePrice(model.pricing?.completion)
          && isFreePrice(model.pricing?.request)
      })
      .map((model: {
        id: string
        name?: string
        context_length?: number
        description?: string
      }) => {
        const contextLabel = formatContextLength(model.context_length)
        return {
          id: model.id,
          label: [model.id, contextLabel, 'free'].filter(Boolean).join(' · '),
          description: model.description || model.name || undefined,
        }
      })
      .sort((a: LlmCatalogModelDetail, b: LlmCatalogModelDetail) => a.id.localeCompare(b.id, 'fr-FR'))

    const payload = {
      openRouterModels: details.map((detail) => detail.id),
      openRouterModelDetails: details,
      openRouterError: null,
    }
    openRouterCache = { cachedAt: Date.now(), payload }
    return payload
  } catch {
    const fallback = {
      openRouterModels: getAvailableOpenRouterLlmModels(),
      openRouterModelDetails: buildFallbackOpenRouterModelDetails(),
      openRouterError: 'OpenRouter listing indisponible',
    }
    openRouterCache = { cachedAt: Date.now(), payload: fallback }
    return fallback
  }
}

export async function GET(request: NextRequest) {
  const provider = (request.nextUrl.searchParams.get('provider') ?? 'all') as LlmCatalogProvider
  const force = request.nextUrl.searchParams.get('force') === '1'

  if (provider === 'local') {
    return NextResponse.json({ data: await getLocalModels() })
  }

  if (provider === 'openrouter') {
    const openRouter = await getOpenRouterModels(force)
    return NextResponse.json({
      data: {
        ...openRouter,
        openRouterAvailable: isOpenRouterLlmReachable(),
      },
    })
  }

  if (provider === 'cloud') {
    return NextResponse.json({
      data: {
        cloudModels: getAvailableCloudLlmModels(),
        cloudModelDetails: buildCloudModelDetails(),
        cloudAvailable: isCloudLlmReachable(),
      },
    })
  }

  const [local, openRouter] = await Promise.all([
    getLocalModels(),
    getOpenRouterModels(force),
  ])

  return NextResponse.json({
    data: {
      ...local,
      cloudModels: getAvailableCloudLlmModels(),
      cloudModelDetails: buildCloudModelDetails(),
      cloudAvailable: isCloudLlmReachable(),
      ...openRouter,
      openRouterAvailable: isOpenRouterLlmReachable(),
    },
  })
}