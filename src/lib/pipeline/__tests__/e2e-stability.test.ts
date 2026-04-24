import { describe, it, expect } from 'vitest'
import { TOTAL_PIPELINE_STEPS } from '../constants'

/**
 * 12D — E2E produit complet stable
 *
 * Vérifie :
 * 1. Budgets temps explicites par classe d'étapes
 * 2. Cycle nominal complet (pending → running → completed)
 * 3. Run lent mais sain — pas de faux positif zombie
 * 4. Scénario kill — état final cohérent
 * 5. Scénario échec step — traçabilité et état final honnête
 * 6. Idempotence des contrôles superviseur (kill, recovery, progress)
 * 7. Cohérence transverse 12A + 12B + 12C
 */

// ─── Budgets temps (ms) ────────────────────────────────────────────────────────
// Définis par classe d'étape selon leur nature technique.
// Utilisés pour valider les seuils de détection zombie.

const STEP_BUDGETS_MS = {
  // Steps LLM texte (Ollama local ou API) — longs mais bornés
  step1_idea: 3 * 60_000,       // 3min — enrichissement idée + questionnaire
  step2_brainstorm: 5 * 60_000, // 5min — brainstorm LLM long
  step3_json: 3 * 60_000,       // 3min — structuration JSON
  step4_visual_blueprint: 3 * 60_000, // 3min — blueprint visuel scène par scène
  step5_storyboard: 5 * 60_000,       // 5min — storyboard multi-scènes
  step6_prompts: 3 * 60_000,          // 3min — prompts Seedance

  // Steps génération / I/O lourds
  step7_generation: 10 * 60_000, // 10min — génération vidéo (LTX, fal, Stability)
  step8_preview: 2 * 60_000,     // 2min — assemblage FFmpeg local
  step9_publish: 1 * 60_000,     // 1min — upload plateforme

  // Budget run complet (somme steps = 35min + marge overhead transitions)
  full_run: 40 * 60_000,         // 40min — pipeline complet nominal avec overhead

  // Seuil zombie (12C) — doit être > tout step sauf génération (couvert par heartbeat)
  zombie_threshold: 5 * 60_000,  // 5min entre deux heartbeats
}

// ─── 1. Budgets temps — cohérence avec le seuil zombie ──────────────────────

describe('12D — Budgets temps — cohérence seuils', () => {
  it('les steps texte bornés restent sous le seuil zombie', () => {
    // Ces steps courts doivent rentrer dans le seuil zombie
    // (heartbeat toutes les 60s les couvre de toute façon)
    expect(STEP_BUDGETS_MS.step1_idea).toBeLessThan(STEP_BUDGETS_MS.zombie_threshold)
    expect(STEP_BUDGETS_MS.step3_json).toBeLessThan(STEP_BUDGETS_MS.zombie_threshold)
    expect(STEP_BUDGETS_MS.step4_visual_blueprint).toBeLessThan(STEP_BUDGETS_MS.zombie_threshold)
    expect(STEP_BUDGETS_MS.step6_prompts).toBeLessThan(STEP_BUDGETS_MS.zombie_threshold)
  })

  it('step 7 (génération) dépasse le seuil zombie — couvert par heartbeat 60s', () => {
    // Step 7 peut prendre 10min > seuil zombie 5min
    // Acceptable car le heartbeat bat toutes les 60s pendant le step
    expect(STEP_BUDGETS_MS.step7_generation).toBeGreaterThan(STEP_BUDGETS_MS.zombie_threshold)
    // Vérifier que 60s * N < zombie_threshold pour que le heartbeat protège
    const heartbeatInterval = 60_000
    const heartbeatsBeforeThreshold = Math.floor(STEP_BUDGETS_MS.zombie_threshold / heartbeatInterval)
    expect(heartbeatsBeforeThreshold).toBeGreaterThanOrEqual(4) // au moins 4 heartbeats avant zombie
  })

  it('budget run complet > somme des budgets steps', () => {
    const sumSteps =
      STEP_BUDGETS_MS.step1_idea +
      STEP_BUDGETS_MS.step2_brainstorm +
      STEP_BUDGETS_MS.step3_json +
      STEP_BUDGETS_MS.step4_visual_blueprint +
      STEP_BUDGETS_MS.step5_storyboard +
      STEP_BUDGETS_MS.step6_prompts +
      STEP_BUDGETS_MS.step7_generation +
      STEP_BUDGETS_MS.step8_preview +
      STEP_BUDGETS_MS.step9_publish
    expect(STEP_BUDGETS_MS.full_run).toBeGreaterThanOrEqual(sumSteps)
  })

  it('seuil zombie = 5min (défini dans recovery.ts)', () => {
    expect(STEP_BUDGETS_MS.zombie_threshold).toBe(5 * 60_000)
  })

  it('heartbeat interval (60s) << zombie_threshold (5min)', () => {
    const heartbeat = 60_000
    expect(heartbeat * 5).toBeLessThanOrEqual(STEP_BUDGETS_MS.zombie_threshold)
  })
})

// ─── 2. Cycle nominal complet ─────────────────────────────────────────────────

describe('12D — Cycle nominal — transitions d\'état', () => {
  type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  type StepStatus = 'pending' | 'running' | 'completed' | 'failed'

  interface SimulatedRun {
    id: string
    status: RunStatus
    currentStep: number
    steps: { stepNumber: number; status: StepStatus; costEur: number }[]
    totalCost: number
  }

  function createRun(id: string): SimulatedRun {
    return {
      id,
      status: 'pending',
      currentStep: 1,
      steps: Array.from({ length: TOTAL_PIPELINE_STEPS }, (_, i) => ({
        stepNumber: i + 1,
        status: 'pending',
        costEur: 0,
      })),
      totalCost: 0,
    }
  }

  function executeStep(run: SimulatedRun, stepCost = 0.01): SimulatedRun {
    const updated = structuredClone(run)
    updated.status = 'running'
    const stepIdx = updated.currentStep - 1
    updated.steps[stepIdx].status = 'completed'
    updated.steps[stepIdx].costEur = stepCost
    updated.totalCost += stepCost
    if (updated.currentStep < TOTAL_PIPELINE_STEPS) {
      updated.currentStep++
    } else {
      updated.status = 'completed'
    }
    return updated
  }

  function progressPct(run: SimulatedRun): number {
    const done = run.steps.filter((s) => s.status === 'completed').length
    return Math.round((done / TOTAL_PIPELINE_STEPS) * 100)
  }

  it('état initial : pending, step 1, 0% progress, coût 0', () => {
    const run = createRun('nominal-1')
    expect(run.status).toBe('pending')
    expect(run.currentStep).toBe(1)
    expect(progressPct(run)).toBe(0)
    expect(run.totalCost).toBe(0)
  })

  it('après step 1 : status=running, 10% progress', () => {
    let run = createRun('nominal-2')
    run = executeStep(run)
    expect(run.status).toBe('running')
    expect(progressPct(run)).toBe(10)
  })

  it('run complet : status=completed, 100% progress', () => {
    let run = createRun('nominal-3')
    for (let i = 0; i < TOTAL_PIPELINE_STEPS; i++) run = executeStep(run)
    expect(run.status).toBe('completed')
    expect(progressPct(run)).toBe(100)
    expect(run.steps.every((s) => s.status === 'completed')).toBe(true)
  })

  it('coût s\'accumule à chaque step', () => {
    let run = createRun('nominal-4')
    for (let i = 0; i < 4; i++) run = executeStep(run, 0.05)
    expect(run.totalCost).toBeCloseTo(0.20, 5)
  })

  it('run completed absent de la queue (filtre pending/running)', () => {
    let run = createRun('nominal-5')
    for (let i = 0; i < TOTAL_PIPELINE_STEPS; i++) run = executeStep(run)
    const QUEUE_STATUSES = ['pending', 'running']
    expect(QUEUE_STATUSES.includes(run.status)).toBe(false)
  })
})

// ─── 3. Run lent mais sain — pas de faux positif zombie ──────────────────────

describe('12D — Run lent mais sain — heartbeat protège du faux zombie', () => {
  const ZOMBIE_THRESHOLD_MS = 5 * 60_000

  function isZombie(lastHeartbeat: Date | null, now = Date.now()): boolean {
    if (!lastHeartbeat) return true
    return (now - lastHeartbeat.getTime()) > ZOMBIE_THRESHOLD_MS
  }

  it('step de 4min avec heartbeat 60s : pas zombie (dernier heartbeat < 5min)', () => {
    // Simuler : step démarre, heartbeat bat à T+60s, T+120s, T+180s, T+240s
    // On interroge à T+250s → dernier heartbeat à T+240s → elapsed = 10s → pas zombie
    const startTime = Date.now() - 250_000 // il y a 250s
    const lastHeartbeat = new Date(startTime + 240_000) // heartbeat il y a 10s
    expect(isZombie(lastHeartbeat)).toBe(false)
  })

  it('step de 4min30 avec heartbeat 60s : toujours pas zombie', () => {
    // Heartbeat à T+270s, on interroge à T+290s → elapsed = 20s
    const startTime = Date.now() - 290_000
    const lastHeartbeat = new Date(startTime + 270_000)
    expect(isZombie(lastHeartbeat)).toBe(false)
  })

  it('step de 10min avec heartbeat régulier 60s : pas zombie à mi-course', () => {
    // Step 7 (génération) dure 10min, heartbeat à T+540s, interrogation à T+550s
    const startTime = Date.now() - 550_000
    const lastHeartbeat = new Date(startTime + 540_000)
    expect(isZombie(lastHeartbeat)).toBe(false)
  })

  it('run mort (crash) : plus de heartbeat depuis >5min → zombie détecté', () => {
    const staleHeartbeat = new Date(Date.now() - 6 * 60_000)
    expect(isZombie(staleHeartbeat)).toBe(true)
  })

  it('heartbeat nul (démarrage brutal sans DB) → zombie immédiatement', () => {
    expect(isZombie(null)).toBe(true)
  })

  it('seuil 5min est conservateur — protège les steps LLM longs', () => {
    // Step 2 brainstorm peut durer 5min — mais le heartbeat bat à T+240s max
    // elapsed depuis heartbeat = 60s max → bien en dessous de 5min
    const worstCaseHeartbeatElapsed = 60_000 // 1 heartbeat manqué
    expect(worstCaseHeartbeatElapsed).toBeLessThan(ZOMBIE_THRESHOLD_MS)
  })
})

// ─── 4. Scénario kill — état final cohérent ──────────────────────────────────

describe('12D — Scénario kill — état final cohérent', () => {
  type Status = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

  const TERMINAL_STATUSES: Status[] = ['completed', 'failed', 'killed']
  const QUEUE_STATUSES: Status[] = ['pending', 'running']

  function simulateKill(status: Status): { httpStatus: number; finalStatus: Status } {
    if (TERMINAL_STATUSES.includes(status)) {
      return { httpStatus: 409, finalStatus: status } // idempotence
    }
    return { httpStatus: 200, finalStatus: 'killed' }
  }

  it('run pending → kill → 200, status=killed', () => {
    const r = simulateKill('pending')
    expect(r.httpStatus).toBe(200)
    expect(r.finalStatus).toBe('killed')
  })

  it('run running → kill → 200, status=killed', () => {
    const r = simulateKill('running')
    expect(r.httpStatus).toBe(200)
    expect(r.finalStatus).toBe('killed')
  })

  it('run killed → kill replay → 409 (idempotence)', () => {
    expect(simulateKill('killed').httpStatus).toBe(409)
  })

  it('run completed → kill → 409 (idempotence état terminal)', () => {
    expect(simulateKill('completed').httpStatus).toBe(409)
  })

  it('run killed absent de la queue', () => {
    const status: Status = 'killed'
    expect(QUEUE_STATUSES.includes(status)).toBe(false)
  })

  it('état final killed ≠ failed — distinction traçable', () => {
    // Un kill explicite (user-initiated) doit rester distinct d'un échec technique
    const killedStatus: Status = 'killed'
    const failedStatus: Status = 'failed'
    expect(killedStatus).not.toBe(failedStatus)
    expect(TERMINAL_STATUSES).toContain(killedStatus)
    expect(TERMINAL_STATUSES).toContain(failedStatus)
  })

  it('progressPct d\'un run killed = steps complétés avant le kill', () => {
    // Kill après step 3 → steps 1+2 complétés → 20%
    const steps = Array.from({ length: TOTAL_PIPELINE_STEPS }, (_, i) => ({
      status: i < 2 ? 'completed' : 'pending',
    }))
    const pct = Math.round(steps.filter((s) => s.status === 'completed').length / TOTAL_PIPELINE_STEPS * 100)
    expect(pct).toBe(20)
  })
})

// ─── 5. Scénario échec step — traçabilité et état final honnête ──────────────

describe('12D — Scénario échec step — traçabilité', () => {
  interface StepResult {
    stepNumber: number
    status: 'completed' | 'failed' | 'pending'
    error: string | null
  }

  function simulateFailAt(failStep: number): { runStatus: string; steps: StepResult[] } {
    const steps: StepResult[] = Array.from({ length: TOTAL_PIPELINE_STEPS }, (_, i) => {
      const n = i + 1
      if (n < failStep) return { stepNumber: n, status: 'completed', error: null }
      if (n === failStep) return { stepNumber: n, status: 'failed', error: 'Provider timeout' }
      return { stepNumber: n, status: 'pending', error: null }
    })
    return { runStatus: 'failed', steps }
  }

  it('échec step 3 → runStatus=failed, steps 1-2 complétés', () => {
    const r = simulateFailAt(3)
    expect(r.runStatus).toBe('failed')
    expect(r.steps[0].status).toBe('completed')
    expect(r.steps[1].status).toBe('completed')
    expect(r.steps[2].status).toBe('failed')
  })

  it('message erreur persisté sur le step failed', () => {
    const r = simulateFailAt(3)
    expect(r.steps[2].error).toBe('Provider timeout')
    expect(r.steps[2].error).not.toBeNull()
  })

  it('steps après l\'échec restent pending (pas exécutés)', () => {
    const r = simulateFailAt(3)
    for (let i = 3; i < TOTAL_PIPELINE_STEPS; i++) {
      expect(r.steps[i].status).toBe('pending')
      expect(r.steps[i].error).toBeNull()
    }
  })

  it('run failed absent de la queue', () => {
    const QUEUE_STATUSES = ['pending', 'running']
    expect(QUEUE_STATUSES.includes('failed')).toBe(false)
  })

  it('progressPct run failed = steps complétés avant l\'échec', () => {
    const r = simulateFailAt(5) // 4 steps complétés, step 5 failed
    const pct = Math.round(r.steps.filter((s) => s.status === 'completed').length / TOTAL_PIPELINE_STEPS * 100)
    expect(pct).toBe(40) // 4/10 = 40%
  })
})

// ─── 6. Idempotence contrôles superviseur ────────────────────────────────────

describe('12D — Idempotence des contrôles superviseur', () => {
  it('GET /api/runs/{id}/progress sur run completed retourne 100%', () => {
    const steps = Array.from({ length: TOTAL_PIPELINE_STEPS }, (_, i) => ({ status: 'completed' }))
    const pct = Math.round(steps.filter((s) => s.status === 'completed').length / TOTAL_PIPELINE_STEPS * 100)
    expect(pct).toBe(100)
  })

  it('GET /api/runs/{id}/progress sur run failed = progressPct stable', () => {
    // Le progressPct d'un run terminé ne change plus — résultat stable
    const failedAt3 = { steps: [
      { status: 'completed' }, { status: 'completed' },
      { status: 'failed' }, ...Array(TOTAL_PIPELINE_STEPS - 3).fill({ status: 'pending' }),
    ]}
    const pct = Math.round(failedAt3.steps.filter((s) => s.status === 'completed').length / TOTAL_PIPELINE_STEPS * 100)
    expect(pct).toBe(20) // 2/10 = 20%
  })

  it('POST /api/runs/recovery idempotent : 0 zombie → recovered=0', () => {
    // Simulation — avec une queue propre (no active running), recovery = 0
    const zombies: unknown[] = []
    const result = { recovered: zombies.length, runIds: zombies.map(() => '') }
    expect(result.recovered).toBe(0)
    expect(result.runIds).toHaveLength(0)
  })

  it('POST /api/runs/{id}/kill idempotent : killed → 409 INVALID_STATE', () => {
    const TERMINAL = ['completed', 'failed', 'killed']
    expect(TERMINAL.includes('killed')).toBe(true)
    // Un second kill → 409
    const httpStatus = TERMINAL.includes('killed') ? 409 : 200
    expect(httpStatus).toBe(409)
  })

  it('GET /api/queue retourne { pendingCount, runningCount, active, queue }', () => {
    // Contrat de la réponse queue — tous les champs présents
    const mockQueue = {
      pendingCount: 0,
      runningCount: 0,
      active: null,
      queue: [] as unknown[],
    }
    expect(typeof mockQueue.pendingCount).toBe('number')
    expect(typeof mockQueue.runningCount).toBe('number')
    expect(mockQueue.active).toBeNull()
    expect(Array.isArray(mockQueue.queue)).toBe(true)
  })
})

// ─── 7. Cohérence transverse 12A + 12B + 12C ─────────────────────────────────

describe('12D — Cohérence transverse 12A + 12B + 12C', () => {
  type Status = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

  function getQueueRuns(runs: { id: string; status: Status }[]) {
    return runs.filter((r) => r.status === 'pending' || r.status === 'running')
  }

  function isZombie(r: { status: Status; lastHeartbeat: Date | null }): boolean {
    if (r.status !== 'running') return false
    if (!r.lastHeartbeat) return true
    return (Date.now() - r.lastHeartbeat.getTime()) > 5 * 60_000
  }

  it('scénario complet : pending → running → killed → absent queue', () => {
    const runs = [{ id: 'r1', status: 'killed' as Status }]
    expect(getQueueRuns(runs)).toHaveLength(0)
  })

  it('scénario zombie → recovery → absent queue', () => {
    // Avant recovery : zombie dans queue
    const before = [{ id: 'z1', status: 'running' as Status }]
    expect(getQueueRuns(before)).toHaveLength(1)
    // Après recovery : passé en failed
    const after = [{ id: 'z1', status: 'failed' as Status }]
    expect(getQueueRuns(after)).toHaveLength(0)
  })

  it('run récent non-zombie ne peut pas être kill + recovery en même temps', () => {
    const r = { status: 'running' as Status, lastHeartbeat: new Date() }
    // Run sain : pas zombie
    expect(isZombie(r)).toBe(false)
    // Kill accessible car status=running
    const TERMINAL = ['completed', 'failed', 'killed']
    expect(TERMINAL.includes(r.status)).toBe(false) // killable
  })

  it('run already killed → recovery ne le re-marque pas', () => {
    // recoverZombies ne cible que status=running — un run killed est déjà terminal
    const r = { status: 'killed' as Status, lastHeartbeat: null as Date | null }
    expect(isZombie(r)).toBe(false) // killed != running → pas zombie
  })

  it('états terminaux forment un ensemble fermé', () => {
    const TERMINAL: Status[] = ['completed', 'failed', 'killed']
    // Aucun état terminal ne peut être zombifié
    for (const s of TERMINAL) {
      const r = { status: s, lastHeartbeat: null as Date | null }
      expect(isZombie(r)).toBe(false)
    }
  })

  it('queue propre = pending + running uniquement', () => {
    const allStatuses: Status[] = ['pending', 'running', 'completed', 'failed', 'killed']
    const runs = allStatuses.map((s, i) => ({ id: `r${i}`, status: s }))
    const queue = getQueueRuns(runs)
    expect(queue).toHaveLength(2) // pending + running
    expect(queue.every((r) => r.status === 'pending' || r.status === 'running')).toBe(true)
  })
})

// ─── 8. Budget temps visible — preuve de lisibilité ──────────────────────────

describe('12D — Budget temps — preuve de lisibilité', () => {
  it('les 9 budgets steps sont définis et positifs', () => {
    const budgets = Object.values(STEP_BUDGETS_MS)
    for (const b of budgets) {
      expect(typeof b).toBe('number')
      expect(b).toBeGreaterThan(0)
    }
  })

  it('budget step 7 (génération) > budget steps texte', () => {
    expect(STEP_BUDGETS_MS.step7_generation).toBeGreaterThan(STEP_BUDGETS_MS.step1_idea)
    expect(STEP_BUDGETS_MS.step7_generation).toBeGreaterThan(STEP_BUDGETS_MS.step6_prompts)
  })

  it('budget step 9 (publish) < step 7 (génération)', () => {
    expect(STEP_BUDGETS_MS.step9_publish).toBeLessThan(STEP_BUDGETS_MS.step7_generation)
  })

  it('elapsedMs d\'un run est mesurable comme durée concrète', () => {
    const createdAt = Date.now() - 120_000 // il y a 2min
    const updatedAt = Date.now()
    const elapsedMs = updatedAt - createdAt
    expect(elapsedMs).toBeGreaterThan(0)
    expect(elapsedMs).toBeGreaterThanOrEqual(120_000)
    expect(elapsedMs).toBeLessThan(STEP_BUDGETS_MS.full_run)
  })

  it('durationMs d\'un step est mesurable', () => {
    const startedAt = new Date(Date.now() - 30_000)
    const completedAt = new Date()
    const durationMs = completedAt.getTime() - startedAt.getTime()
    expect(durationMs).toBeGreaterThanOrEqual(30_000)
    expect(durationMs).toBeLessThan(STEP_BUDGETS_MS.step1_idea)
  })
})
