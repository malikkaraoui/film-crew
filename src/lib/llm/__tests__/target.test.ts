import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('llm/target', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
    vi.resetModules()
  })

  it('résout correctement une cible OpenRouter avec auth et en-têtes utiles', async () => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
    process.env.OPENROUTER_TEXT_MODELS = 'nvidia/nemotron-3-nano-30b-a3b:free,google/gemini-2.0-flash-lite-001'
    process.env.NEXT_PUBLIC_APP_URL = 'https://filmcrew.local'
    process.env.NEXT_PUBLIC_APP_NAME = 'FILM CREW'

    const target = await import('../target')
    const resolved = target.resolveLlmTarget('openrouter', 'google/gemini-2.0-flash-lite-001')

    expect(target.normalizeLlmMode('openrouter')).toBe('openrouter')
    expect(target.getAvailableOpenRouterLlmModels()).toContain('google/gemini-2.0-flash-lite-001')
    expect(target.isOpenRouterLlmReachable()).toBe(true)
    expect(resolved.mode).toBe('openrouter')
    expect(resolved.model).toBe('google/gemini-2.0-flash-lite-001')
    expect(resolved.host).toBe('https://openrouter.ai/api/v1')
    expect(resolved.headers).toMatchObject({
      Authorization: 'Bearer test-openrouter-key',
      'HTTP-Referer': 'https://filmcrew.local',
      'X-Title': 'FILM CREW',
    })
  })

  it('retombe sur le modèle OpenRouter par défaut si un modèle invalide est fourni', async () => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'

    const target = await import('../target')
    const normalized = target.normalizeLlmModelForMode('openrouter', 'modele-sans-slash')

    expect(normalized).toBe('nvidia/nemotron-3-nano-30b-a3b:free')
  })
})
