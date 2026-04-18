import type { LLMProvider, LLMMessage, LLMOpts, LLMResult, ProviderHealth } from '../types'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

export const ollamaProvider: LLMProvider = {
  name: 'ollama',
  type: 'llm',

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
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
    const model = opts.model || 'qwen3.5:4b'
    const start = Date.now()

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.7,
          num_predict: opts.maxTokens ?? 2048,
        },
      }),
    })

    if (!res.ok) throw new Error(`Ollama erreur: ${res.status}`)

    const data = await res.json()
    const latencyMs = Date.now() - start

    return {
      content: data.message?.content ?? '',
      model,
      tokens: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
      latencyMs,
      costEur: 0,
    }
  },
}
