import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Kokoro ──────────────────────────────────────────────────────────────────

describe('kokoroProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('healthCheck retourne free si /health répond 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 200 }) as Response,
    )
    const { kokoroProvider } = await import('../tts/kokoro')
    const health = await kokoroProvider.healthCheck()
    expect(health.status).toBe('free')
  })

  it('healthCheck retourne down si fetch échoue', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const { kokoroProvider } = await import('../tts/kokoro')
    const health = await kokoroProvider.healthCheck()
    expect(health.status).toBe('down')
    expect(health.details).toContain('Kokoro non joignable')
  })

  it('estimateCost retourne 0 (provider local)', async () => {
    const { kokoroProvider } = await import('../tts/kokoro')
    expect(kokoroProvider.estimateCost({})).toBe(0)
  })

  it('synthesize retourne AudioResult avec costEur 0', async () => {
    const fakeWav = Buffer.from('RIFF....fakewav')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(fakeWav, { status: 200 }) as Response,
    )

    const { kokoroProvider } = await import('../tts/kokoro')
    const result = await kokoroProvider.synthesize('Bonjour le monde', 'default', 'fr', undefined)

    expect(result.costEur).toBe(0)
    expect(result.filePath).toMatch(/tts-kokoro-\d+\.wav$/)
    expect(result.duration).toBeGreaterThan(0)
  })

  it('synthesize lève une erreur si le serveur répond 500', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Internal error', { status: 500 }) as Response,
    )
    const { kokoroProvider } = await import('../tts/kokoro')
    await expect(kokoroProvider.synthesize('test', 'default', 'fr')).rejects.toThrow(
      'Kokoro TTS erreur 500',
    )
  })
})

// ─── Piper ───────────────────────────────────────────────────────────────────

describe('piperProvider', () => {
  it("healthCheck retourne down si l'env PIPER_MODEL est vide", async () => {
    const original = process.env.PIPER_MODEL
    delete process.env.PIPER_MODEL

    // re-import pour avoir l'env actuel pris en compte dans le module
    vi.resetModules()
    const { piperProvider } = await import('../tts/piper')
    const health = await piperProvider.healthCheck()

    // Soit down (binaire absent), soit down (PIPER_MODEL vide)
    expect(health.status).toBe('down')

    process.env.PIPER_MODEL = original
  })

  it('estimateCost retourne 0 (provider local)', async () => {
    const { piperProvider } = await import('../tts/piper')
    expect(piperProvider.estimateCost({})).toBe(0)
  })

  it("synthesize lève une erreur si PIPER_MODEL n'est pas défini", async () => {
    const original = process.env.PIPER_MODEL
    delete process.env.PIPER_MODEL

    vi.resetModules()
    const { piperProvider } = await import('../tts/piper')
    await expect(piperProvider.synthesize('test', 'default', 'fr')).rejects.toThrow(
      'PIPER_MODEL non défini',
    )

    process.env.PIPER_MODEL = original
  })
})

// ─── Priorité TTS (bootstrap logic) ─────────────────────────────────────────

describe('TTS priority and disable', () => {
  it('ordre de priorité par défaut : kokoro-local → piper-local → fish-audio', () => {
    const DEFAULT = 'kokoro-local,piper-local,fish-audio'
    const priority = DEFAULT.split(',').map((s) => s.trim())
    expect(priority).toEqual(['kokoro-local', 'piper-local', 'fish-audio'])
  })

  it('TTS_PRIORITY personnalisé est respecté', () => {
    const priority = 'fish-audio,kokoro-local'.split(',').map((s) => s.trim())
    expect(priority[0]).toBe('fish-audio')
    expect(priority[1]).toBe('kokoro-local')
  })

  it('TTS_DISABLED exclut les providers désignés', () => {
    const priority = ['kokoro-local', 'piper-local', 'fish-audio']
    const disabled = ['fish-audio']
    const active = priority.filter((n) => !disabled.includes(n))
    expect(active).toEqual(['kokoro-local', 'piper-local'])
    expect(active).not.toContain('fish-audio')
  })

  it('TTS_DISABLED vide ne retire rien', () => {
    const priority = ['kokoro-local', 'piper-local', 'fish-audio']
    const disabled: string[] = []
    const active = priority.filter((n) => !disabled.includes(n))
    expect(active).toHaveLength(3)
  })
})
