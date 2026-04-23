import { NextResponse } from 'next/server'
import { getAvailableCloudLlmModels, isCloudLlmReachable } from '@/lib/llm/target'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

async function getLocalModels(): Promise<{ models: string[]; error?: string }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      return { models: [], error: `Ollama HTTP ${res.status}` }
    }

    const data = await res.json()
    const models: string[] = (data.models ?? []).map((entry: { name: string }) => entry.name)
    return { models }
  } catch {
    return { models: [], error: 'Ollama non joignable' }
  }
}

export async function GET() {
  const local = await getLocalModels()

  return NextResponse.json({
    data: {
      localModels: local.models,
      localError: local.error ?? null,
      cloudModels: getAvailableCloudLlmModels(),
      cloudAvailable: isCloudLlmReachable(),
    },
  })
}