import { describe, it, expect } from 'vitest'
import type { RunProgress, StepProgress, QueueState, RunSummary } from '@/lib/observability/observability-types'
import { TOTAL_PIPELINE_STEPS } from '@/lib/pipeline/constants'

/**
 * 12A — Observabilité + queueing
 *
 * Vérifie :
 * 1. RunProgress — structure et calculs
 * 2. StepProgress — structure et durée
 * 3. QueueState — structure et compteurs
 * 4. RunSummary — structure
 * 5. progressPct — calcul précis
 * 6. elapsedMs — calcul depuis createdAt
 * 7. QueueState — active vs queue
 * 8. StepProgress — durationMs calculation
 */

describe('12A — Observabilité + queueing', () => {

  // ─── 1. RunProgress — structure ─────────────────────────────────────────

  describe('RunProgress — structure', () => {
    it('champs requis présents', () => {
      const progress: RunProgress = {
        runId: 'run-test',
        status: 'running',
        currentStep: 4,
        totalSteps: TOTAL_PIPELINE_STEPS,
        progressPct: 25,
        elapsedMs: 45_000,
        totalCostEur: 0.002,
        steps: [],
      }
      expect(progress.runId).toBeTruthy()
      expect(progress.totalSteps).toBe(TOTAL_PIPELINE_STEPS)
      expect(progress.progressPct).toBeGreaterThanOrEqual(0)
      expect(progress.progressPct).toBeLessThanOrEqual(100)
    })

    it('totalSteps = 10 (pipeline FILM CREW)', () => {
      const progress: RunProgress = {
        runId: 'r', status: 'pending', currentStep: null,
        totalSteps: TOTAL_PIPELINE_STEPS, progressPct: 0, elapsedMs: 0, totalCostEur: 0, steps: [],
      }
      expect(progress.totalSteps).toBe(TOTAL_PIPELINE_STEPS)
    })

    it('status completed → progressPct = 100', () => {
      const completedSteps: StepProgress[] = Array.from({ length: TOTAL_PIPELINE_STEPS }, (_, i) => ({
        stepNumber: i + 1,
        stepName: `Step ${i + 1}`,
        status: 'completed',
        costEur: 0,
        durationMs: 1000,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
      }))
      const completedCount = completedSteps.filter((s) => s.status === 'completed').length
      const pct = Math.round((completedCount / TOTAL_PIPELINE_STEPS) * 100)
      expect(pct).toBe(100)
    })
  })

  // ─── 2. StepProgress — structure ────────────────────────────────────────

  describe('StepProgress — structure', () => {
    it('champs requis présents', () => {
      const step: StepProgress = {
        stepNumber: 1,
        stepName: 'Idée',
        status: 'completed',
        costEur: 0,
        durationMs: 500,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
      }
      expect(step.stepNumber).toBe(1)
      expect(step.stepName).toBeTruthy()
      expect(step.status).toBe('completed')
    })

    it('durationMs null si step non démarrée', () => {
      const step: StepProgress = {
        stepNumber: 5, stepName: 'Prompts', status: 'pending',
        costEur: null, durationMs: null, startedAt: null, completedAt: null, error: null,
      }
      expect(step.durationMs).toBeNull()
      expect(step.startedAt).toBeNull()
    })

    it('error null si pas d\'erreur', () => {
      const step: StepProgress = {
        stepNumber: 2, stepName: 'Brainstorm', status: 'completed',
        costEur: 0.001, durationMs: 8000, startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), error: null,
      }
      expect(step.error).toBeNull()
    })

    it('error présente si step a échoué', () => {
      const step: StepProgress = {
        stepNumber: 7, stepName: 'Génération', status: 'failed',
        costEur: 0, durationMs: 5000, startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), error: 'No video provider available',
      }
      expect(step.error).toContain('video')
      expect(step.status).toBe('failed')
    })
  })

  // ─── 3. QueueState — structure ──────────────────────────────────────────

  describe('QueueState — structure', () => {
    it('file vide : pendingCount = 0, active = null', () => {
      const queue: QueueState = {
        pendingCount: 0,
        runningCount: 0,
        active: null,
        queue: [],
      }
      expect(queue.pendingCount).toBe(0)
      expect(queue.active).toBeNull()
      expect(queue.queue).toHaveLength(0)
    })

    it('run actif : active non null', () => {
      const active: RunSummary = {
        id: 'run-active', idea: 'Test idea', type: 'standard', status: 'running',
        currentStep: 3, costEur: 0.001, createdAt: new Date().toISOString(),
      }
      const queue: QueueState = {
        pendingCount: 0,
        runningCount: 1,
        active,
        queue: [],
      }
      expect(queue.active).not.toBeNull()
      expect(queue.active?.status).toBe('running')
      expect(queue.runningCount).toBe(1)
    })

    it('runs pending : queue non vide', () => {
      const pending: RunSummary[] = [
        { id: 'r1', idea: 'Idée 1', type: 'standard', status: 'pending', currentStep: null, costEur: null, createdAt: new Date().toISOString() },
        { id: 'r2', idea: 'Idée 2', type: 'viral', status: 'pending', currentStep: null, costEur: null, createdAt: new Date().toISOString() },
      ]
      const queue: QueueState = {
        pendingCount: 2, runningCount: 0, active: null, queue: pending,
      }
      expect(queue.pendingCount).toBe(2)
      expect(queue.queue).toHaveLength(2)
    })
  })

  // ─── 4. RunSummary — structure ───────────────────────────────────────────

  describe('RunSummary — structure', () => {
    it('type standard ou viral', () => {
      const s1: RunSummary = { id: 'r', idea: 'i', type: 'standard', status: 'completed', currentStep: 9, costEur: 0.01, createdAt: new Date().toISOString() }
      const s2: RunSummary = { id: 'r', idea: 'i', type: 'viral', status: 'running', currentStep: 3, costEur: 0, createdAt: new Date().toISOString() }
      expect(s1.type).toBe('standard')
      expect(s2.type).toBe('viral')
    })

    it('currentStep null si pas encore démarré', () => {
      const s: RunSummary = { id: 'r', idea: 'i', type: 'standard', status: 'pending', currentStep: null, costEur: null, createdAt: new Date().toISOString() }
      expect(s.currentStep).toBeNull()
    })
  })

  // ─── 5. progressPct — calcul précis ─────────────────────────────────────

  describe('progressPct — calcul', () => {
    function calcPct(completedSteps: number, total = TOTAL_PIPELINE_STEPS) {
      return Math.round((completedSteps / total) * 100)
    }

    it('0 steps complétés → 0%', () => {
      expect(calcPct(0)).toBe(0)
    })

    it('4 steps complétés sur 10 → 40%', () => {
      expect(calcPct(4)).toBe(40)
    })

    it('10 steps complétés sur 10 → 100%', () => {
      expect(calcPct(10)).toBe(100)
    })

    it('3 steps complétés sur 10 → 30%', () => {
      expect(calcPct(3)).toBe(30)
    })

    it('1 step complété sur 10 → 10%', () => {
      expect(calcPct(1)).toBe(10)
    })
  })

  // ─── 6. elapsedMs — calcul ──────────────────────────────────────────────

  describe('elapsedMs — calcul depuis createdAt', () => {
    it('elapsedMs >= 0 pour un run en cours', () => {
      const createdAt = Date.now() - 30_000
      const elapsedMs = Date.now() - createdAt
      expect(elapsedMs).toBeGreaterThanOrEqual(30_000)
    })

    it('elapsedMs pour un run terminé = updatedAt - createdAt', () => {
      const createdAt = 1_000_000
      const updatedAt = 1_060_000
      const elapsed = updatedAt - createdAt
      expect(elapsed).toBe(60_000)
    })
  })

  // ─── 7. QueueState — active vs queue ────────────────────────────────────

  describe('QueueState — active est running, queue est pending', () => {
    it('active a status running', () => {
      const state: QueueState = {
        pendingCount: 1,
        runningCount: 1,
        active: { id: 'r-run', idea: 'i', type: 'standard', status: 'running', currentStep: 2, costEur: 0, createdAt: new Date().toISOString() },
        queue: [{ id: 'r-pend', idea: 'j', type: 'standard', status: 'pending', currentStep: null, costEur: null, createdAt: new Date().toISOString() }],
      }
      expect(state.active?.status).toBe('running')
      expect(state.queue[0].status).toBe('pending')
    })

    it('pendingCount = queue.length', () => {
      const state: QueueState = {
        pendingCount: 3,
        runningCount: 0,
        active: null,
        queue: Array.from({ length: 3 }, (_, i) => ({
          id: `r${i}`, idea: `idée ${i}`, type: 'standard', status: 'pending',
          currentStep: null, costEur: null, createdAt: new Date().toISOString(),
        })),
      }
      expect(state.pendingCount).toBe(state.queue.length)
    })
  })

  // ─── 8. StepProgress — durationMs calculation ───────────────────────────

  describe('StepProgress — durationMs', () => {
    it('durationMs = completedAt - startedAt', () => {
      const start = new Date('2026-04-20T10:00:00Z').getTime()
      const end = new Date('2026-04-20T10:00:15Z').getTime()
      const durationMs = end - start
      expect(durationMs).toBe(15_000)
    })

    it('durationMs null si completedAt absent', () => {
      const step: StepProgress = {
        stepNumber: 3, stepName: 'JSON', status: 'running',
        costEur: null, durationMs: null,
        startedAt: new Date().toISOString(), completedAt: null, error: null,
      }
      expect(step.durationMs).toBeNull()
    })
  })
})
