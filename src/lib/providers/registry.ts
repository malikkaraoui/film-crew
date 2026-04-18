import type { BaseProvider, ProviderHealth } from './types'

class ProviderRegistry {
  private providers: Map<string, BaseProvider[]> = new Map()

  register(provider: BaseProvider): void {
    const list = this.providers.get(provider.type) ?? []
    list.push(provider)
    this.providers.set(provider.type, list)
  }

  getByType(type: string): BaseProvider[] {
    return this.providers.get(type) ?? []
  }

  async getBest(type: string): Promise<BaseProvider | null> {
    const list = this.getByType(type)
    for (const provider of list) {
      const health = await provider.healthCheck()
      if (health.status === 'free') return provider
    }
    // Fallback : retourner le premier même s'il est dégradé
    for (const provider of list) {
      const health = await provider.healthCheck()
      if (health.status !== 'down') return provider
    }
    return null
  }

  async getFallback(type: string, exclude: string): Promise<BaseProvider | null> {
    const list = this.getByType(type).filter((p) => p.name !== exclude)
    for (const provider of list) {
      const health = await provider.healthCheck()
      if (health.status === 'free' || health.status === 'degraded') return provider
    }
    return null
  }

  async healthCheckAll(): Promise<Map<string, { name: string; health: ProviderHealth }[]>> {
    const results = new Map<string, { name: string; health: ProviderHealth }[]>()

    for (const [type, list] of this.providers) {
      const checks = await Promise.all(
        list.map(async (p) => ({
          name: p.name,
          health: await p.healthCheck(),
        }))
      )
      results.set(type, checks)
    }

    return results
  }

  getAllProviders(): { name: string; type: string }[] {
    const all: { name: string; type: string }[] = []
    for (const [, list] of this.providers) {
      for (const p of list) {
        all.push({ name: p.name, type: p.type })
      }
    }
    return all
  }
}

// Singleton
export const registry = new ProviderRegistry()
