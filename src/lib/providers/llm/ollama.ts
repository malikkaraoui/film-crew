import type { LLMProvider, LLMMessage, LLMOpts, LLMResult, ProviderHealth } from '../types'

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const DEFAULT_OLLAMA_CHAT_TIMEOUT_MS = 180_000

const runtimeState = {
  activeRequests: 0,
  activeModels: new Set<string>(),
}

function getBusyDetails(): string {
  const models = Array.from(runtimeState.activeModels)
  const modelLabel = models.length > 0 ? ` (${models.join(', ')})` : ''
  return `${runtimeState.activeRequests} requête(s) en cours${modelLabel}`
}

function normalizeOllamaHost(host: string): string {
  return host.replace(/\/+$/, '')
}

function buildOllamaApiUrl(host: string, path: string): string {
  const normalized = normalizeOllamaHost(host)
  return normalized.endsWith('/api') ? `${normalized}${path}` : `${normalized}/api${path}`
}

function isOpenRouterHost(host: string): boolean {
  return /openrouter\.ai/i.test(host)
}

function buildOpenAiChatCompletionsUrl(host: string): string {
  return `${normalizeOllamaHost(host)}/chat/completions`
}

export const ollamaProvider: LLMProvider = {
  name: 'ollama',
  type: 'llm',

  async healthCheck(): Promise<ProviderHealth> {
    if (runtimeState.activeRequests > 0) {
      return {
        status: 'busy',
        lastCheck: new Date().toISOString(),
        details: getBusyDetails(),
      }
    }

    if (process.env.OPENROUTER_API_KEY?.trim()) {
      return {
        status: 'free',
        lastCheck: new Date().toISOString(),
        details: 'OpenRouter configuré',
      }
    }

    try {
      const res = await fetch(buildOllamaApiUrl(DEFAULT_OLLAMA_URL, '/tags'), {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) return { status: 'free', lastCheck: new Date().toISOString() }
      return { status: 'degraded', lastCheck: new Date().toISOString(), details: `HTTP ${res.status}` }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'Ollama non joignable' }
    }
  },

  estimateCost(): number {
    return 0 // Ollama local = gratuit
  },

  async chat(messages: LLMMessage[], opts: LLMOpts = {}): Promise<LLMResult> {
    const model = opts.model || process.env.OLLAMA_MODEL || 'mistral:latest'
    const host = opts.host || DEFAULT_OLLAMA_URL
    const timeoutMs = opts.timeoutMs ?? DEFAULT_OLLAMA_CHAT_TIMEOUT_MS
    const start = Date.now()
    const openRouterMode = isOpenRouterHost(host)
    const requestBody = openRouterMode
      ? {
          model,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 2048,
          stream: false,
        }
      : {
          model,
          messages,
          stream: false,
          think: false,
          options: {
            temperature: opts.temperature ?? 0.7,
            num_predict: opts.maxTokens ?? 2048,
          },
        }

    runtimeState.activeRequests += 1
    runtimeState.activeModels.add(model)

    try {
      const res = await fetch(openRouterMode ? buildOpenAiChatCompletionsUrl(host) : buildOllamaApiUrl(host, '/chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(requestBody),
      })

      if (!res.ok) {
        const details = await res.text().catch(() => '')
        throw new Error(`Ollama erreur: ${res.status}${details ? ` — ${details.slice(0, 240)}` : ''}`)
      }

      const data = await res.json()
      const latencyMs = Date.now() - start
      const content = openRouterMode
        ? data.choices?.[0]?.message?.content ?? ''
        : data.message?.content ?? data.response ?? ''
      const thinking = openRouterMode ? '' : data.message?.thinking ?? data.thinking ?? ''

      if (!content.trim()) {
        const details = [
          `model=${model}`,
          `tokens=${openRouterMode ? (data.usage?.total_tokens ?? 0) : (data.eval_count ?? 0)}`,
          `prompt_tokens=${openRouterMode ? (data.usage?.prompt_tokens ?? 0) : (data.prompt_eval_count ?? 0)}`,
          `done_reason=${openRouterMode ? (data.choices?.[0]?.finish_reason ?? 'unknown') : (data.done_reason ?? 'unknown')}`,
          thinking ? 'thinking_only=true' : null,
        ].filter(Boolean).join(', ')

        throw new Error(openRouterMode ? `OpenRouter réponse vide (${details})` : `Ollama réponse vide (${details})`)
      }

      return {
        content,
        model,
        tokens: openRouterMode
          ? (data.usage?.total_tokens ?? 0)
          : (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
        latencyMs,
        costEur: 0,
      }
    } finally {
      runtimeState.activeRequests = Math.max(0, runtimeState.activeRequests - 1)
      if (runtimeState.activeRequests === 0) {
        runtimeState.activeModels.clear()
      } else {
        runtimeState.activeModels.delete(model)
      }
    }
  },
}
