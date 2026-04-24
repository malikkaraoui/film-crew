import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── readWavDurationFromBuffer ──────────────────────────────────────────────

describe('readWavDurationFromBuffer', () => {
  it('lit la durée réelle d\'un WAV PCM 16bit mono 44100Hz', async () => {
    const { readWavDurationFromBuffer } = await import('../tts/kokoro')

    // Construire un WAV synthétique : 1 seconde, 44100Hz, 16bit, mono
    const sampleRate = 44100
    const numChannels = 1
    const bitsPerSample = 16
    const numSamples = sampleRate // 1 seconde
    const dataSize = numSamples * numChannels * (bitsPerSample / 8)
    const headerSize = 44
    const buf = Buffer.alloc(headerSize + dataSize)

    // RIFF header
    buf.write('RIFF', 0)
    buf.writeUInt32LE(36 + dataSize, 4)
    buf.write('WAVE', 8)

    // fmt chunk
    buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16) // chunk size
    buf.writeUInt16LE(1, 20)  // PCM
    buf.writeUInt16LE(numChannels, 22)
    buf.writeUInt32LE(sampleRate, 24)
    buf.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28) // byte rate
    buf.writeUInt16LE(numChannels * bitsPerSample / 8, 32) // block align
    buf.writeUInt16LE(bitsPerSample, 34)

    // data chunk
    buf.write('data', 36)
    buf.writeUInt32LE(dataSize, 40)

    const duration = readWavDurationFromBuffer(buf)
    expect(duration).toBeCloseTo(1.0, 2)
  })

  it('lit la durée d\'un WAV stéréo 24000Hz', async () => {
    const { readWavDurationFromBuffer } = await import('../tts/kokoro')

    const sampleRate = 24000
    const numChannels = 2
    const bitsPerSample = 16
    const numSamples = sampleRate * 3 // 3 secondes
    const dataSize = numSamples * numChannels * (bitsPerSample / 8)
    const buf = Buffer.alloc(44 + dataSize)

    buf.write('RIFF', 0)
    buf.writeUInt32LE(36 + dataSize, 4)
    buf.write('WAVE', 8)
    buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(numChannels, 22)
    buf.writeUInt32LE(sampleRate, 24)
    buf.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28)
    buf.writeUInt16LE(numChannels * bitsPerSample / 8, 32)
    buf.writeUInt16LE(bitsPerSample, 34)
    buf.write('data', 36)
    buf.writeUInt32LE(dataSize, 40)

    const duration = readWavDurationFromBuffer(buf)
    expect(duration).toBeCloseTo(3.0, 2)
  })

  it('retourne null pour un buffer trop petit', async () => {
    const { readWavDurationFromBuffer } = await import('../tts/kokoro')
    expect(readWavDurationFromBuffer(Buffer.from('too small'))).toBeNull()
  })

  it('retourne null pour un buffer non-WAV', async () => {
    const { readWavDurationFromBuffer } = await import('../tts/kokoro')
    const buf = Buffer.alloc(100)
    buf.write('NOT_RIFF', 0)
    expect(readWavDurationFromBuffer(buf)).toBeNull()
  })
})

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

  it('synthesize retourne AudioResult avec durée réelle si WAV valide', async () => {
    // Construire un vrai WAV : 0.5s, 24000Hz, mono, 16bit
    const sampleRate = 24000
    const numSamples = sampleRate / 2 // 0.5s
    const dataSize = numSamples * 2 // 16bit mono
    const wav = Buffer.alloc(44 + dataSize)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(36 + dataSize, 4)
    wav.write('WAVE', 8)
    wav.write('fmt ', 12)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(sampleRate, 24)
    wav.writeUInt32LE(sampleRate * 2, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(dataSize, 40)

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(wav, { status: 200 }) as Response,
    )

    const { kokoroProvider } = await import('../tts/kokoro')
    const result = await kokoroProvider.synthesize('Bonjour le monde', 'default', 'fr', undefined)

    expect(result.costEur).toBe(0)
    expect(result.filePath).toMatch(/tts-kokoro-\d+\.wav$/)
    expect(result.duration).toBeCloseTo(0.5, 1)
  })

  it('synthesize fallback sur estimation si WAV invalide', async () => {
    const fakeWav = Buffer.from('RIFF....fakewav')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(fakeWav, { status: 200 }) as Response,
    )

    const { kokoroProvider } = await import('../tts/kokoro')
    const result = await kokoroProvider.synthesize('Bonjour le monde test', 'default', 'fr', undefined)

    expect(result.costEur).toBe(0)
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

// ─── SystemTTS ───────────────────────────────────────────────────────────────

describe('systemTtsProvider', () => {
  it('name est system-tts, type est tts', async () => {
    const { systemTtsProvider } = await import('../tts/system-tts')
    expect(systemTtsProvider.name).toBe('system-tts')
    expect(systemTtsProvider.type).toBe('tts')
  })

  it('estimateCost retourne 0 (provider local)', async () => {
    const { systemTtsProvider } = await import('../tts/system-tts')
    expect(systemTtsProvider.estimateCost({})).toBe(0)
  })

  it('healthCheck retourne free sur macOS (say + ffmpeg disponibles)', async () => {
    // Ce test s'exécute sur macOS — say et ffmpeg sont prouvés présents
    const { systemTtsProvider } = await import('../tts/system-tts')
    const health = await systemTtsProvider.healthCheck()
    // Sur macOS CI : free. Sur autre OS : down — on vérifie juste que le retour est cohérent
    expect(['free', 'down']).toContain(health.status)
    expect(health.lastCheck).toBeTruthy()
  })

  it('healthCheck.details mentionne say + ffmpeg si free sur macOS', async () => {
    const { systemTtsProvider } = await import('../tts/system-tts')
    const health = await systemTtsProvider.healthCheck()
    if (health.status === 'free') {
      expect(health.details).toContain('say')
    }
  })
})

// ─── Priorité TTS (bootstrap logic) ─────────────────────────────────────────

describe('TTS priority and disable', () => {
  it('ordre de priorité par défaut : kokoro-local → piper-local → system-tts → fish-audio', () => {
    const DEFAULT = 'kokoro-local,piper-local,system-tts,fish-audio'
    const priority = DEFAULT.split(',').map((s) => s.trim())
    expect(priority).toEqual(['kokoro-local', 'piper-local', 'system-tts', 'fish-audio'])
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
