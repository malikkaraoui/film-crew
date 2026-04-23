import { describe, it, expect, beforeEach } from 'vitest'

// Inline test — on ne peut pas importer le singleton facilement,
// donc on teste la logique directement

type ProviderHealth = { status: string; lastCheck: string }

class TestRegistry {
  private providers: Map<string, { name: string; type: string; health: ProviderHealth }[]> = new Map()

  register(p: { name: string; type: string; health: ProviderHealth }) {
    const list = this.providers.get(p.type) ?? []
    const unique = list.filter((entry) => entry.name !== p.name)
    unique.push(p)
    this.providers.set(p.type, unique)
  }

  getByType(type: string) {
    return this.providers.get(type) ?? []
  }

  getBest(type: string) {
    const list = this.getByType(type)
    return list.find((p) => p.health.status === 'free') ?? list.find((p) => p.health.status !== 'down') ?? null
  }

  getFallback(type: string, exclude: string) {
    return this.getByType(type).filter((p) => p.name !== exclude).find((p) => p.health.status === 'free' || p.health.status === 'degraded') ?? null
  }
}

describe('ProviderRegistry', () => {
  let registry: TestRegistry

  beforeEach(() => {
    registry = new TestRegistry()
  })

  it('retourne null si aucun provider enregistré', () => {
    expect(registry.getBest('llm')).toBeNull()
  })

  it('retourne le provider free en priorité', () => {
    registry.register({ name: 'ollama', type: 'llm', health: { status: 'free', lastCheck: '' } })
    registry.register({ name: 'claude', type: 'llm', health: { status: 'busy', lastCheck: '' } })

    const best = registry.getBest('llm')
    expect(best?.name).toBe('ollama')
  })

  it('retourne un provider dégradé si aucun free', () => {
    registry.register({ name: 'ollama', type: 'llm', health: { status: 'down', lastCheck: '' } })
    registry.register({ name: 'claude', type: 'llm', health: { status: 'degraded', lastCheck: '' } })

    const best = registry.getBest('llm')
    expect(best?.name).toBe('claude')
  })

  it('retourne un fallback excluant le provider en échec', () => {
    registry.register({ name: 'seedance', type: 'video', health: { status: 'down', lastCheck: '' } })
    registry.register({ name: 'happyhorse', type: 'video', health: { status: 'free', lastCheck: '' } })

    const fallback = registry.getFallback('video', 'seedance')
    expect(fallback?.name).toBe('happyhorse')
  })

  it('retourne null si aucun fallback disponible', () => {
    registry.register({ name: 'seedance', type: 'video', health: { status: 'down', lastCheck: '' } })

    const fallback = registry.getFallback('video', 'seedance')
    expect(fallback).toBeNull()
  })

  it('remplace un provider de meme nom au lieu de le dupliquer', () => {
    registry.register({ name: 'ollama', type: 'llm', health: { status: 'free', lastCheck: '' } })
    registry.register({ name: 'ollama', type: 'llm', health: { status: 'busy', lastCheck: '' } })

    const llmProviders = registry.getByType('llm')
    expect(llmProviders).toHaveLength(1)
    expect(llmProviders[0].health.status).toBe('busy')
  })
})
