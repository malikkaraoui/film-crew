import { describe, it, expect, afterAll } from 'vitest'
import { rmSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { step1Idea } from '../steps/step-1-idea'
import { buildIntentionPrefix } from '@/lib/intention/schema'

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'pipeline-test')

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe('Pipeline Steps', () => {
  describe('Step 1 — Idée', () => {
    it('retourne success avec coût 0', async () => {
      const result = await step1Idea.execute({
        runId: 'test-run',
        chainId: 'test-chain',
        idea: 'Test idea',
        brandKitPath: null,
        storagePath: '/tmp/test',
        intentionPath: null,
        template: null,
      })

      expect(result.success).toBe(true)
      expect(result.costEur).toBe(0)
      const data = result.outputData as Record<string, unknown>
      expect(data.idea).toBe('Test idea')
      expect(data.hasIntention).toBe(false)
      expect(data.answeredCount).toBe(0)
    })

    it('a le bon numéro d\'étape', () => {
      expect(step1Idea.stepNumber).toBe(1)
      expect(step1Idea.name).toBe('Idée')
    })

    it('sans intentionPath : outputData.idea === ctx.idea (idée brute inchangée)', async () => {
      const idea = 'La polémique Mbappé expliquée en 90 secondes'
      const result = await step1Idea.execute({
        runId: 'test-run-noq',
        chainId: 'test-chain',
        idea,
        brandKitPath: null,
        storagePath: '/tmp/test',
        intentionPath: null,
        template: null,
      })

      const data = result.outputData as Record<string, unknown>
      expect(data.idea).toBe(idea)
      expect(data.originalIdea).toBe(idea)
      expect(data.hasIntention).toBe(false)
    })
  })

  // ─── Propagation intention → step 1 → ctx.idea enrichi ──────────────────

  describe('Step 1 + intention.json — enrichissement de ctx.idea', () => {
    it('avec intention.json : outputData.idea contient le prefix d\'intention', async () => {
      mkdirSync(FIXTURE_DIR, { recursive: true })

      const answers = { genre: 'educatif', ton: 'humoristique', palette: 'froide' }
      const prefix = buildIntentionPrefix(answers)
      const intentionData = { answers, prefix, createdAt: new Date().toISOString() }
      const intentionPath = join(FIXTURE_DIR, 'intention-enriched.json')
      await writeFile(intentionPath, JSON.stringify(intentionData, null, 2))

      const idea = 'La polémique Mbappé expliquée en 90 secondes'
      const result = await step1Idea.execute({
        runId: 'test-run-q',
        chainId: 'test-chain',
        idea,
        brandKitPath: null,
        storagePath: FIXTURE_DIR,
        intentionPath,
        template: null,
      })

      const data = result.outputData as Record<string, unknown>
      expect(result.success).toBe(true)
      expect(data.hasIntention).toBe(true)
      expect(typeof data.idea).toBe('string')
      // L'idée enrichie contient le prefix ET l'idée originale
      expect(data.idea as string).toContain(idea)
      expect(data.idea as string).toContain('[Production]')
      expect(data.idea as string).toContain('Éducatif')
      // L'idée enrichie est différente de l'idée brute
      expect(data.idea).not.toBe(idea)
      expect(data.originalIdea).toBe(idea)
    })

    it('deux intentions différentes → deux outputData.idea différents', async () => {
      mkdirSync(FIXTURE_DIR, { recursive: true })

      const answers1 = { genre: 'educatif', ton: 'serieux', palette: 'froide' }
      const answers2 = { genre: 'fiction', ton: 'humoristique', palette: 'chaude' }

      const path1 = join(FIXTURE_DIR, 'intention-a.json')
      const path2 = join(FIXTURE_DIR, 'intention-b.json')

      await writeFile(path1, JSON.stringify({ answers: answers1, prefix: buildIntentionPrefix(answers1), createdAt: new Date().toISOString() }, null, 2))
      await writeFile(path2, JSON.stringify({ answers: answers2, prefix: buildIntentionPrefix(answers2), createdAt: new Date().toISOString() }, null, 2))

      const idea = 'Même idée brute'

      const [result1, result2] = await Promise.all([
        step1Idea.execute({ runId: 'r1', chainId: 'c', idea, brandKitPath: null, storagePath: FIXTURE_DIR, intentionPath: path1, template: null }),
        step1Idea.execute({ runId: 'r2', chainId: 'c', idea, brandKitPath: null, storagePath: FIXTURE_DIR, intentionPath: path2, template: null }),
      ])

      const d1 = result1.outputData as Record<string, unknown>
      const d2 = result2.outputData as Record<string, unknown>

      // Même idée brute → deux enrichissements distincts
      expect(d1.idea).not.toBe(d2.idea)
      expect(d1.originalIdea).toBe(idea)
      expect(d2.originalIdea).toBe(idea)
      expect(d1.idea as string).toContain('Éducatif')
      expect(d2.idea as string).toContain('Fiction')
    })

    // ─── Preuve que ctx.idea est muté dans le pipeline (simulation engine) ─
    it('engine : ctx.idea est muté après step 1 si intention enrichit l\'idée', async () => {
      mkdirSync(FIXTURE_DIR, { recursive: true })

      const answers = { genre: 'documentaire', ton: 'poetique' }
      const prefix = buildIntentionPrefix(answers)
      const intentionPath = join(FIXTURE_DIR, 'intention-engine.json')
      await writeFile(intentionPath, JSON.stringify({ answers, prefix, createdAt: new Date().toISOString() }, null, 2))

      const idea = 'L\'histoire de l\'eau sur Mars'

      // Simuler ce que l'engine fait après step 1
      const ctx = { runId: 'r', chainId: 'c', idea, brandKitPath: null, storagePath: FIXTURE_DIR, intentionPath, template: null }
      const result = await step1Idea.execute(ctx)
      const data = result.outputData as Record<string, unknown>

      // L'engine mute ctx.idea si data.idea diffère
      if (data?.idea && typeof data.idea === 'string' && data.idea !== ctx.idea) {
        ctx.idea = data.idea
      }

      // ctx.idea est maintenant l'idée enrichie — step 2 la recevra
      expect(ctx.idea).not.toBe(idea)
      expect(ctx.idea).toContain(idea)
      expect(ctx.idea).toContain('[Narration]')
      expect(ctx.idea).toContain('Poétique')
      // originalIdea reste accessible dans outputData
      expect(data.originalIdea).toBe(idea)
    })
  })
})
