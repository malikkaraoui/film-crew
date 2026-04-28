import type { LlmMode } from '@/types/run'

export type LlmCatalogProvider = 'all' | 'local' | 'cloud' | 'openrouter'

export type LlmCatalogModelDetail = {
  id: string
  label: string
  description?: string
}

export type LlmCatalog = {
  localModels: string[]
  localModelDetails: LlmCatalogModelDetail[]
  localError: string | null
  cloudModels: string[]
  cloudModelDetails: LlmCatalogModelDetail[]
  cloudAvailable: boolean
  openRouterModels: string[]
  openRouterModelDetails: LlmCatalogModelDetail[]
  openRouterAvailable: boolean
  openRouterError: string | null
}

export const EMPTY_LLM_CATALOG: LlmCatalog = {
  localModels: [],
  localModelDetails: [],
  localError: null,
  cloudModels: [],
  cloudModelDetails: [],
  cloudAvailable: false,
  openRouterModels: [],
  openRouterModelDetails: [],
  openRouterAvailable: false,
  openRouterError: null,
}

export function mergeLlmCatalog(current: LlmCatalog, incoming: Partial<LlmCatalog>): LlmCatalog {
  return {
    ...current,
    ...incoming,
    localModels: incoming.localModels ?? current.localModels,
    localModelDetails: incoming.localModelDetails ?? current.localModelDetails,
    cloudModels: incoming.cloudModels ?? current.cloudModels,
    cloudModelDetails: incoming.cloudModelDetails ?? current.cloudModelDetails,
    openRouterModels: incoming.openRouterModels ?? current.openRouterModels,
    openRouterModelDetails: incoming.openRouterModelDetails ?? current.openRouterModelDetails,
  }
}

export function getModelsForMode(catalog: LlmCatalog, mode: LlmMode): string[] {
  if (mode === 'cloud') return catalog.cloudModels
  if (mode === 'openrouter') return catalog.openRouterModels
  return catalog.localModels
}

export function getModelDetailsForMode(catalog: LlmCatalog, mode: LlmMode): LlmCatalogModelDetail[] {
  if (mode === 'cloud') return catalog.cloudModelDetails
  if (mode === 'openrouter') return catalog.openRouterModelDetails
  return catalog.localModelDetails
}

export function buildModelOptions(details: LlmCatalogModelDetail[], selectedModel: string): LlmCatalogModelDetail[] {
  const normalizedSelectedModel = selectedModel.trim()
  if (!normalizedSelectedModel) return details
  if (details.some((detail) => detail.id === normalizedSelectedModel)) return details
  return [{ id: normalizedSelectedModel, label: normalizedSelectedModel }, ...details]
}

export function getModelPlaceholder(mode: LlmMode): string {
  if (mode === 'cloud') return 'deepseek-v3.1:671b-cloud'
  if (mode === 'openrouter') return 'nvidia/nemotron-3-nano-30b-a3b:free'
  return 'qwen2.5:7b'
}

export function findModelDetail(catalog: LlmCatalog, mode: LlmMode, modelId: string): LlmCatalogModelDetail | null {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId) return null
  return getModelDetailsForMode(catalog, mode).find((detail) => detail.id === normalizedModelId) ?? null
}