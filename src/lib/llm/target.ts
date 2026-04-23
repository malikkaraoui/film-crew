import type { LlmMode } from '@/types/run'

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on'])
const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off'])

const DEFAULT_LOCAL_MODEL_FALLBACK = 'qwen2.5:7b'
const DEFAULT_CLOUD_MODEL_FALLBACK = 'deepseek-v3.1:671b-cloud'
const FALLBACK_CLOUD_MODELS = [
  'deepseek-v3.1:671b-cloud',
  'gemma4:31b-cloud',
]

export const DEFAULT_LOCAL_LLM_MODEL = (process.env.OLLAMA_MODEL || DEFAULT_LOCAL_MODEL_FALLBACK).trim()
export const DEFAULT_CLOUD_LLM_MODEL = (
  process.env.DEFAULT_CLOUD_LLM_MODEL
  || process.env.OLLAMA_STORYBOARD_CLOUD_MODEL
  || DEFAULT_CLOUD_MODEL_FALLBACK
).trim()

export function normalizeLlmMode(value: unknown): LlmMode {
  return value === 'cloud' ? 'cloud' : 'local'
}

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function getAvailableCloudLlmModels(): string[] {
  const configured = parseList(process.env.OLLAMA_CLOUD_MODELS || process.env.AVAILABLE_CLOUD_LLM_MODELS)
  const merged = [...configured, DEFAULT_CLOUD_LLM_MODEL, ...FALLBACK_CLOUD_MODELS]
  return [...new Set(merged.filter(Boolean))]
}

export function normalizeLlmModelForMode(mode: LlmMode, model?: string | null): string {
  const normalizedMode = normalizeLlmMode(mode)
  const normalizedModel = (model || '').trim()

  if (normalizedMode === 'cloud') {
    if (!normalizedModel) return DEFAULT_CLOUD_LLM_MODEL

    const knownCloudModels = getAvailableCloudLlmModels()
    if (knownCloudModels.includes(normalizedModel) || normalizedModel.includes('-cloud')) {
      return normalizedModel
    }

    return DEFAULT_CLOUD_LLM_MODEL
  }

  return normalizedModel || DEFAULT_LOCAL_LLM_MODEL
}

function getStoryboardCloudEnabledValue(): string {
  return (process.env.OLLAMA_STORYBOARD_CLOUD_ENABLED ?? '').trim()
}

function getOllamaCloudApiKey(): string | undefined {
  const explicitApiKey = process.env.OLLAMA_API_KEY?.trim()
  if (explicitApiKey) return explicitApiKey

  const legacyValue = getStoryboardCloudEnabledValue()
  const lowered = legacyValue.toLowerCase()
  if (!legacyValue || ENABLED_VALUES.has(lowered) || DISABLED_VALUES.has(lowered)) {
    return undefined
  }

  return legacyValue
}

export function isCloudLlmReachable(): boolean {
  const enabledValue = getStoryboardCloudEnabledValue()
  if (!enabledValue) return Boolean(getOllamaCloudApiKey())

  const lowered = enabledValue.toLowerCase()
  if (ENABLED_VALUES.has(lowered)) return true
  if (DISABLED_VALUES.has(lowered)) return false
  return true
}

export function resolveLlmTarget(mode: LlmMode, model?: string | null): {
  mode: LlmMode
  model: string
  host?: string
  headers?: Record<string, string>
  targetLabel: string
} {
  const normalizedMode = normalizeLlmMode(mode)
  const normalizedModel = normalizeLlmModelForMode(normalizedMode, model)

  if (normalizedMode === 'cloud') {
    const apiKey = getOllamaCloudApiKey()
    if (apiKey) {
      return {
        mode: normalizedMode,
        model: normalizedModel,
        host: (process.env.OLLAMA_CLOUD_URL || 'https://ollama.com').trim(),
        headers: { Authorization: `Bearer ${apiKey}` },
        targetLabel: `cloud · ${normalizedModel}`,
      }
    }

    return {
      mode: normalizedMode,
      model: normalizedModel,
      host: (process.env.OLLAMA_URL || 'http://localhost:11434').trim(),
      targetLabel: `cloud-proxy · ${normalizedModel}`,
    }
  }

  return {
    mode: normalizedMode,
    model: normalizedModel,
    host: (process.env.OLLAMA_URL || 'http://localhost:11434').trim(),
    targetLabel: `local · ${normalizedModel}`,
  }
}