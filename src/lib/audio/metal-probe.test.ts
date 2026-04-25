import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MetalProbeResult, ChipFamily, ChipTier } from './metal-probe'

// ─── parseChipInfo (pur, pas de mock) ───

describe('parseChipInfo', () => {
  it.each<[string, ChipFamily, ChipTier]>([
    ['Apple M1', 'M1', 'base'],
    ['Apple M1 Pro', 'M1', 'pro'],
    ['Apple M1 Max', 'M1', 'max'],
    ['Apple M1 Ultra', 'M1', 'ultra'],
    ['Apple M2', 'M2', 'base'],
    ['Apple M2 Pro', 'M2', 'pro'],
    ['Apple M3', 'M3', 'base'],
    ['Apple M3 Max', 'M3', 'max'],
    ['Apple M4', 'M4', 'base'],
    ['Apple M4 Pro', 'M4', 'pro'],
    ['Intel Core i9', 'unknown', 'unknown'],
    ['', 'unknown', 'unknown'],
  ])('parse "%s" → family=%s, tier=%s', async (brandString, expectedFamily, expectedTier) => {
    const { parseChipInfo } = await import('./metal-probe')
    const result = parseChipInfo(brandString)
    expect(result.family).toBe(expectedFamily)
    expect(result.tier).toBe(expectedTier)
  })

  it('est insensible à la casse', async () => {
    const { parseChipInfo } = await import('./metal-probe')
    const result = parseChipInfo('apple m3 PRO')
    expect(result.family).toBe('M3')
    expect(result.tier).toBe('pro')
  })
})

// ─── probeMetalCapabilities (integration, résultat structuré) ───

describe('probeMetalCapabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retourne un résultat structuré avec tous les champs requis', async () => {
    // Mock fetch pour Kokoro health (éviter ECONNREFUSED)
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    const { probeMetalCapabilities } = await import('./metal-probe')
    const result = await probeMetalCapabilities()

    // Structure de base
    expect(result.platform).toBeTruthy()
    expect(result.arch).toBeTruthy()
    expect(result.probedAt).toBeTruthy()

    // Silicon
    expect(typeof result.silicon.isAppleSilicon).toBe('boolean')
    expect(typeof result.silicon.coreCount).toBe('number')
    expect(result.silicon.coreCount).toBeGreaterThan(0)
    expect(typeof result.silicon.memoryGb).toBe('number')
    expect(result.silicon.memoryGb).toBeGreaterThan(0)
    expect(result.silicon.chipLabel).toBeTruthy()

    // Metal
    expect(typeof result.metal.available).toBe('boolean')

    // Runtimes — tous présents
    for (const name of ['kokoro', 'whisper', 'ffmpeg', 'python'] as const) {
      const rt = result.runtimes[name]
      expect(rt.name).toBe(name)
      expect(typeof rt.available).toBe('boolean')
      expect(typeof rt.details).toBe('string')
    }

    // Recommendations
    expect(typeof result.recommendations.ttsConcurrency).toBe('number')
    expect(result.recommendations.ttsConcurrency).toBeGreaterThanOrEqual(1)
    expect(typeof result.recommendations.whisperModel).toBe('string')
    expect(typeof result.recommendations.metalAcceleration).toBe('boolean')
  })

  it('détecte ffmpeg si présent sur la machine', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    const { probeMetalCapabilities } = await import('./metal-probe')
    const result = await probeMetalCapabilities()

    // ffmpeg devrait être installé sur une machine de dev macOS
    if (result.platform === 'darwin') {
      expect(result.runtimes.ffmpeg.available).toBe(true)
      expect(result.runtimes.ffmpeg.path).toBeTruthy()
      expect(result.runtimes.ffmpeg.details).toContain('ffmpeg')
    }
  })

  it('détecte python si présent sur la machine', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    const { probeMetalCapabilities } = await import('./metal-probe')
    const result = await probeMetalCapabilities()

    // python3 devrait être installé
    expect(result.runtimes.python.available).toBe(true)
    expect(result.runtimes.python.details).toContain('Python')
  })

  it('sur macOS arm64 : silicon.isAppleSilicon = true', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    const { probeMetalCapabilities } = await import('./metal-probe')
    const result = await probeMetalCapabilities()

    if (result.platform === 'darwin' && result.arch === 'arm64') {
      expect(result.silicon.isAppleSilicon).toBe(true)
      expect(result.silicon.chipFamily).not.toBe('unknown')
      expect(result.metal.available).toBe(true)
      expect(result.recommendations.metalAcceleration).toBe(true)
    }
  })

  it('kokoro est down si le serveur n\'est pas lancé', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    const { probeMetalCapabilities } = await import('./metal-probe')
    const result = await probeMetalCapabilities()

    expect(result.runtimes.kokoro.available).toBe(false)
    expect(result.runtimes.kokoro.details).toContain('non joignable')
  })

  it('kokoro est up si le serveur répond', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }) as Response)

    const { probeMetalCapabilities } = await import('./metal-probe')
    const result = await probeMetalCapabilities()

    expect(result.runtimes.kokoro.available).toBe(true)
    expect(result.runtimes.kokoro.details).toContain('opérationnel')
  })
})

// ─── Recommendations logic ───

describe('recommendations', () => {
  it('ttsConcurrency scale avec la RAM', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no')))

    const { probeMetalCapabilities } = await import('./metal-probe')
    const result = await probeMetalCapabilities()

    // Sur une machine Apple Silicon, la concurrence doit être >= 2 si RAM >= 8GB
    if (result.silicon.isAppleSilicon && result.silicon.memoryGb >= 8) {
      expect(result.recommendations.ttsConcurrency).toBeGreaterThanOrEqual(2)
    }

    vi.unstubAllGlobals()
  })

  it('whisperModel scale avec la RAM', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no')))

    const { probeMetalCapabilities } = await import('./metal-probe')
    const result = await probeMetalCapabilities()

    const validModels = ['tiny', 'base', 'small', 'medium']
    expect(validModels).toContain(result.recommendations.whisperModel)

    if (result.silicon.memoryGb >= 16) {
      expect(['small', 'medium']).toContain(result.recommendations.whisperModel)
    }

    vi.unstubAllGlobals()
  })
})
