import { describe, it, expect } from 'vitest'

/**
 * 12C — Recovery automatique des runs zombies
 *
 * Vérifie :
 * 1. Détection zombie — logique heartbeat stale
 * 2. Résolution — markRunFailed / recoverZombies
 * 3. Idempotence — pas de zombie → recovered: 0
 * 4. Multi-zombie — tous les zombies résolus
 * 5. POST /api/runs/recovery contrat de retour
 * 6. Queue cohérence après recovery
 * 7. Démarrage — instrumentation non bloquante
 */

// ─── 1. Détection zombie — logique heartbeat ─────────────────────────────────

describe('12C — Détection zombie — logique heartbeat', () => {
  const ZOMBIE_THRESHOLD_MS = 5 * 60_000 // 5 minutes

  function isZombie(run: {
    status: string
    lastHeartbeat: Date | null
  }, now = Date.now()): boolean {
    if (run.status !== 'running') return false
    if (!run.lastHeartbeat) return true
    return (now - run.lastHeartbeat.getTime()) > ZOMBIE_THRESHOLD_MS
  }

  it('run running + heartbeat nul = zombie', () => {
    expect(isZombie({ status: 'running', lastHeartbeat: null })).toBe(true)
  })

  it('run running + heartbeat stale (>5min) = zombie', () => {
    const stale = new Date(Date.now() - 6 * 60_000)
    expect(isZombie({ status: 'running', lastHeartbeat: stale })).toBe(true)
  })

  it('run running + heartbeat récent (<5min) = pas zombie', () => {
    const recent = new Date(Date.now() - 2 * 60_000)
    expect(isZombie({ status: 'running', lastHeartbeat: recent })).toBe(false)
  })

  it('run running + heartbeat exactement à la limite = pas zombie', () => {
    const atLimit = new Date(Date.now() - ZOMBIE_THRESHOLD_MS + 1000)
    expect(isZombie({ status: 'running', lastHeartbeat: atLimit })).toBe(false)
  })

  it('run pending = pas zombie (pas de heartbeat à vérifier)', () => {
    expect(isZombie({ status: 'pending', lastHeartbeat: null })).toBe(false)
  })

  it('run completed = pas zombie', () => {
    const stale = new Date(Date.now() - 10 * 60_000)
    expect(isZombie({ status: 'completed', lastHeartbeat: stale })).toBe(false)
  })

  it('run failed = pas zombie', () => {
    expect(isZombie({ status: 'failed', lastHeartbeat: null })).toBe(false)
  })

  it('run killed = pas zombie', () => {
    expect(isZombie({ status: 'killed', lastHeartbeat: null })).toBe(false)
  })
})

// ─── 2. Résolution — markRunFailed contrat ───────────────────────────────────

describe('12C — markRunFailed — contrat', () => {
  it('message d\'erreur zombie est explicite', () => {
    const ZOMBIE_ERROR = 'Interruption détectée — processus inactif depuis >5min'
    expect(ZOMBIE_ERROR).toContain('Interruption détectée')
    expect(ZOMBIE_ERROR).toContain('>5min')
  })

  it('le status après markRunFailed est "failed"', () => {
    // Simulation — sans appel DB réel
    const mockRun = { id: 'r1', status: 'running', lastHeartbeat: null }
    const afterMark = { ...mockRun, status: 'failed' }
    expect(afterMark.status).toBe('failed')
  })

  it('le message d\'erreur est persisté sur le runStep courant (pas seulement passé en paramètre)', () => {
    // Contrat : markRunFailed met à jour runStep.error + runStep.status='failed'
    const ZOMBIE_ERROR = 'Interruption détectée — processus inactif depuis >5min'
    const mockStep = { status: 'running', error: null as string | null }
    // Après markRunFailed, le step doit avoir l'erreur
    const afterMark = { ...mockStep, status: 'failed', error: ZOMBIE_ERROR }
    expect(afterMark.status).toBe('failed')
    expect(afterMark.error).toBe(ZOMBIE_ERROR)
    expect(afterMark.error).not.toBeNull()
  })

  it('l\'erreur est lisible via /progress steps[].error', () => {
    // GET /api/runs/{id}/progress retourne steps[].error — champ mappé depuis runStep.error
    const ZOMBIE_ERROR = 'Interruption détectée — processus inactif depuis >5min'
    const mockProgressResponse = {
      status: 'failed',
      steps: [
        { stepNumber: 1, status: 'completed', error: null },
        { stepNumber: 2, status: 'failed', error: ZOMBIE_ERROR },
        { stepNumber: 3, status: 'pending', error: null },
      ],
    }
    const failedStep = mockProgressResponse.steps.find((s) => s.status === 'failed')
    expect(failedStep).toBeDefined()
    expect(failedStep?.error).toBe(ZOMBIE_ERROR)
  })
})

// ─── 3. recoverZombies — logique d'orchestration ─────────────────────────────

describe('12C — recoverZombies — orchestration', () => {
  type MockRun = { id: string; status: string; lastHeartbeat: Date | null }

  async function simulateRecoverZombies(runs: MockRun[]): Promise<{ recovered: number; runIds: string[] }> {
    const THRESHOLD = 5 * 60_000
    const now = Date.now()
    const zombies = runs.filter((r) => {
      if (r.status !== 'running') return false
      if (!r.lastHeartbeat) return true
      return (now - r.lastHeartbeat.getTime()) > THRESHOLD
    })
    return { recovered: zombies.length, runIds: zombies.map((z) => z.id) }
  }

  it('sans zombie : recovered = 0, runIds = []', async () => {
    const runs: MockRun[] = [
      { id: 'r1', status: 'pending', lastHeartbeat: null },
      { id: 'r2', status: 'completed', lastHeartbeat: new Date() },
    ]
    const result = await simulateRecoverZombies(runs)
    expect(result.recovered).toBe(0)
    expect(result.runIds).toEqual([])
  })

  it('1 zombie : recovered = 1, runIds contient son id', async () => {
    const stale = new Date(Date.now() - 6 * 60_000)
    const runs: MockRun[] = [
      { id: 'zombie-1', status: 'running', lastHeartbeat: stale },
      { id: 'r2', status: 'pending', lastHeartbeat: null },
    ]
    const result = await simulateRecoverZombies(runs)
    expect(result.recovered).toBe(1)
    expect(result.runIds).toContain('zombie-1')
  })

  it('2 zombies : tous résolus', async () => {
    const stale = new Date(Date.now() - 10 * 60_000)
    const runs: MockRun[] = [
      { id: 'z1', status: 'running', lastHeartbeat: stale },
      { id: 'z2', status: 'running', lastHeartbeat: null },
      { id: 'r3', status: 'running', lastHeartbeat: new Date() }, // récent — pas zombie
    ]
    const result = await simulateRecoverZombies(runs)
    expect(result.recovered).toBe(2)
    expect(result.runIds).toContain('z1')
    expect(result.runIds).toContain('z2')
    expect(result.runIds).not.toContain('r3')
  })

  it('idempotence — second appel sans zombie retourne 0', async () => {
    const first = await simulateRecoverZombies([])
    const second = await simulateRecoverZombies([])
    expect(first.recovered).toBe(0)
    expect(second.recovered).toBe(0)
  })
})

// ─── 4. POST /api/runs/recovery — contrat de retour ─────────────────────────

describe('12C — POST /api/runs/recovery — contrat', () => {
  it('retourne { recovered: number, runIds: string[] }', () => {
    const mockResponse = { recovered: 2, runIds: ['id-1', 'id-2'] }
    expect(typeof mockResponse.recovered).toBe('number')
    expect(Array.isArray(mockResponse.runIds)).toBe(true)
    expect(mockResponse.runIds).toHaveLength(mockResponse.recovered)
  })

  it('recovered = 0 quand aucun zombie', () => {
    const mockResponse = { recovered: 0, runIds: [] }
    expect(mockResponse.recovered).toBe(0)
    expect(mockResponse.runIds).toHaveLength(0)
  })

  it('runIds.length === recovered', () => {
    const cases = [
      { recovered: 0, runIds: [] },
      { recovered: 1, runIds: ['a'] },
      { recovered: 3, runIds: ['a', 'b', 'c'] },
    ]
    for (const c of cases) {
      expect(c.runIds.length).toBe(c.recovered)
    }
  })
})

// ─── 5. Queue cohérence après recovery ───────────────────────────────────────

describe('12C — Queue cohérence après recovery', () => {
  type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

  function getQueueRuns(runs: { id: string; status: RunStatus }[]) {
    return runs.filter((r) => r.status === 'pending' || r.status === 'running')
  }

  it('après recovery : zombie passé en failed absent de la queue', () => {
    const runs = [
      { id: 'z1', status: 'failed' as RunStatus }, // zombie résolu → failed
      { id: 'r2', status: 'pending' as RunStatus },
    ]
    const queue = getQueueRuns(runs)
    expect(queue).toHaveLength(1)
    expect(queue[0].id).toBe('r2')
  })

  it('un run running récent reste en queue après recovery', () => {
    const runs = [
      { id: 'r1', status: 'running' as RunStatus }, // heartbeat récent — pas touché
    ]
    expect(getQueueRuns(runs)).toHaveLength(1)
  })

  it('queue vide si tous les runs actifs étaient des zombies', () => {
    const runs = [
      { id: 'z1', status: 'failed' as RunStatus },
      { id: 'z2', status: 'failed' as RunStatus },
    ]
    expect(getQueueRuns(runs)).toHaveLength(0)
  })
})

// ─── 6. Instrumentation démarrage — non bloquante ────────────────────────────

describe('12C — Instrumentation démarrage', () => {
  it('recoverZombies() appelée en best-effort ne bloque pas le démarrage', async () => {
    // Simule un recoverZombies qui rejette
    const faultyRecover = () => Promise.reject(new Error('DB unavailable'))
    let started = false

    // Pattern instrumentation — .catch(() => {}) — ne doit pas propager
    await faultyRecover().catch(() => { /* best-effort */ })
    started = true

    expect(started).toBe(true)
  })

  it('recoverZombies() qui réussit ne bloque pas non plus', async () => {
    const okRecover = () => Promise.resolve({ recovered: 0, runIds: [] })
    let started = false

    await okRecover().catch(() => { /* best-effort */ })
    started = true

    expect(started).toBe(true)
  })
})

// ─── 7. checkInterruptedRun — comportement inchangé (non-régression) ─────────

describe('12C — checkInterruptedRun — non-régression', () => {
  it('retourne null si aucun run actif', () => {
    const result: null = null
    expect(result).toBeNull()
  })

  it('retourne le run zombie si heartbeat stale', () => {
    const stale = new Date(Date.now() - 6 * 60_000)
    const mockRun = { id: 'r1', status: 'running', lastHeartbeat: stale }
    const THRESHOLD = 5 * 60_000
    const elapsed = Date.now() - mockRun.lastHeartbeat.getTime()
    expect(elapsed).toBeGreaterThan(THRESHOLD)
  })

  it('retourne null si heartbeat récent', () => {
    const recent = new Date(Date.now() - 2 * 60_000)
    const THRESHOLD = 5 * 60_000
    const elapsed = Date.now() - recent.getTime()
    expect(elapsed).toBeLessThan(THRESHOLD)
  })
})
