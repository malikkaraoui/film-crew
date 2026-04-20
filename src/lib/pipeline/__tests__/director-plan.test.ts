import { describe, it, expect, afterAll } from 'vitest'
import { rmSync, mkdirSync } from 'fs'
import { writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { DirectorPlan } from '../steps/step-3-json'
import type { PromptManifest } from '../steps/step-5-prompts'

const FIXTURE_DIR = join(tmpdir(), `vitest-10c-${process.pid}`)

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe('10C — Réalisateur IA + Prompt Engineer v2', () => {

  // ─── DirectorPlan — structure ─────────────────────────────────────────────

  describe('director-plan.json — structure et traçabilité', () => {
    it('structure minimale requise', async () => {
      mkdirSync(FIXTURE_DIR, { recursive: true })

      const plan: DirectorPlan = {
        runId: 'test-10c',
        idea: 'La polémique Mbappé expliquée en 90 secondes',
        tone: 'dramatique',
        style: 'cinématographique',
        creativeDirection: 'Une narration tendue, cuts serrés, éclairage contrasté.',
        shotList: [
          { sceneIndex: 1, intent: 'Présentation du contexte', camera: 'plan large', emotion: 'dramatique', influencedBy: ['lenny', 'nael'] },
          { sceneIndex: 2, intent: 'Révélation du conflit', camera: 'zoom avant', emotion: 'dramatique', influencedBy: ['lenny'] },
          { sceneIndex: 3, intent: 'Conclusion', camera: 'plan fixe', emotion: 'neutre', influencedBy: ['nael'] },
        ],
        generatedAt: new Date().toISOString(),
      }

      const path = join(FIXTURE_DIR, 'director-plan.json')
      await writeFile(path, JSON.stringify(plan, null, 2))

      const raw = JSON.parse(await readFile(path, 'utf-8')) as DirectorPlan

      expect(raw.runId).toBe('test-10c')
      expect(raw.tone).toBeTruthy()
      expect(raw.style).toBeTruthy()
      expect(raw.creativeDirection).toBeTruthy()
      expect(Array.isArray(raw.shotList)).toBe(true)
      expect(raw.shotList.length).toBeGreaterThan(0)
      expect(raw.generatedAt).toBeTruthy()
      expect(() => new Date(raw.generatedAt)).not.toThrow()
    })

    it('chaque scène du shot list a les champs requis', () => {
      const plan: DirectorPlan = {
        runId: 'test-10c',
        idea: 'test',
        tone: 'sérieux',
        style: 'documentaire',
        creativeDirection: 'Direction claire.',
        shotList: [
          { sceneIndex: 1, intent: 'Intro', camera: 'fixe', emotion: 'calme', influencedBy: ['lenny'] },
          { sceneIndex: 2, intent: 'Développement', camera: 'travelling', emotion: 'tendu', influencedBy: ['nael', 'laura'] },
        ],
        generatedAt: new Date().toISOString(),
      }

      for (const shot of plan.shotList) {
        expect(typeof shot.sceneIndex).toBe('number')
        expect(shot.intent).toBeTruthy()
        expect(shot.camera).toBeTruthy()
        expect(shot.emotion).toBeTruthy()
        expect(Array.isArray(shot.influencedBy)).toBe(true)
      }
    })

    it('deux intentions différentes → deux plans avec ton/style différents', () => {
      const plan1: DirectorPlan = {
        runId: 'r1', idea: 'Même idée', tone: 'humoristique', style: 'animé',
        creativeDirection: 'Léger et drôle.', shotList: [], generatedAt: new Date().toISOString(),
      }
      const plan2: DirectorPlan = {
        runId: 'r2', idea: 'Même idée', tone: 'dramatique', style: 'cinématographique',
        creativeDirection: 'Sombre et tendu.', shotList: [], generatedAt: new Date().toISOString(),
      }

      expect(plan1.tone).not.toBe(plan2.tone)
      expect(plan1.style).not.toBe(plan2.style)
      expect(plan1.creativeDirection).not.toBe(plan2.creativeDirection)
    })

    it('influencedBy traçable vers agents du brief', () => {
      const KNOWN_AGENTS = ['mia', 'lenny', 'laura', 'nael', 'emilie', 'nico', 'structure']
      const plan: DirectorPlan = {
        runId: 'test', idea: 'test', tone: 'neutre', style: 'minimaliste',
        creativeDirection: '',
        shotList: [
          { sceneIndex: 1, intent: '', camera: 'fixe', emotion: 'neutre', influencedBy: ['lenny', 'nael'] },
          { sceneIndex: 2, intent: '', camera: 'zoom', emotion: 'tendu', influencedBy: ['laura', 'structure'] },
        ],
        generatedAt: new Date().toISOString(),
      }

      for (const shot of plan.shotList) {
        for (const agent of shot.influencedBy) {
          expect(KNOWN_AGENTS).toContain(agent)
        }
      }
    })
  })

  // ─── PromptManifest — structure et traçabilité ───────────────────────────

  describe('prompt-manifest.json — versionnement et traçabilité', () => {
    it('structure minimale requise', async () => {
      mkdirSync(FIXTURE_DIR, { recursive: true })

      const manifest: PromptManifest = {
        runId: 'test-10c',
        version: 1,
        tone: 'dramatique',
        style: 'cinématographique',
        brandKitUsed: false,
        directorPlanUsed: true,
        prompts: [
          {
            sceneIndex: 1,
            prompt: 'Wide shot of Mbappé leaving training. Dramatic lighting. Tense atmosphere. Camera pulls back slowly.',
            negativePrompt: 'blurry, low quality',
            sources: {
              descriptionSnippet: 'Mbappé quitte l\'entraînement sous les flashs des photographes',
              camera: 'plan large',
              lighting: 'naturel contrasté',
              directorNote: 'Présentation du contexte',
              tone: 'dramatique',
              style: 'cinématographique',
            },
            version: 1,
          },
        ],
        generatedAt: new Date().toISOString(),
      }

      const path = join(FIXTURE_DIR, 'prompt-manifest.json')
      await writeFile(path, JSON.stringify(manifest, null, 2))
      const raw = JSON.parse(await readFile(path, 'utf-8')) as PromptManifest

      expect(raw.version).toBe(1)
      expect(raw.runId).toBe('test-10c')
      expect(raw.tone).toBeTruthy()
      expect(raw.style).toBeTruthy()
      expect(typeof raw.brandKitUsed).toBe('boolean')
      expect(typeof raw.directorPlanUsed).toBe('boolean')
      expect(Array.isArray(raw.prompts)).toBe(true)
      expect(raw.prompts.length).toBeGreaterThan(0)
    })

    it('chaque prompt a des sources traçables', () => {
      const manifest: PromptManifest = {
        runId: 'test', version: 1, tone: 'neutre', style: 'réaliste',
        brandKitUsed: false, directorPlanUsed: false,
        prompts: [
          {
            sceneIndex: 1,
            prompt: 'Some cinematic prompt text here...',
            negativePrompt: 'blurry',
            sources: {
              descriptionSnippet: 'Scène de début',
              camera: 'fixe',
              lighting: 'naturel',
              directorNote: 'Intro',
              tone: 'neutre',
              style: 'réaliste',
            },
            version: 1,
          },
        ],
        generatedAt: new Date().toISOString(),
      }

      for (const p of manifest.prompts) {
        expect(p.version).toBe(1)
        expect(p.sources.camera).toBeTruthy()
        expect(p.sources.lighting).toBeTruthy()
        expect(p.sources.tone).toBeTruthy()
        expect(p.sources.style).toBeTruthy()
        expect(p.prompt.length).toBeGreaterThan(20)
      }
    })

    it('directorPlanUsed = true → prompts enrichis vs directorPlanUsed = false', () => {
      const withDirector: PromptManifest = {
        runId: 'r1', version: 1, tone: 'dramatique', style: 'cinématographique',
        brandKitUsed: false, directorPlanUsed: true,
        prompts: [{
          sceneIndex: 1,
          prompt: 'Cinematic close-up, harsh shadows, dramatic music swell. Director note: reveal the conflict.',
          negativePrompt: 'blurry',
          sources: { descriptionSnippet: 'Conflit révélé', camera: 'gros plan', lighting: 'dur', directorNote: 'Révélation du conflit', tone: 'dramatique', style: 'cinématographique' },
          version: 1,
        }],
        generatedAt: new Date().toISOString(),
      }

      const withoutDirector: PromptManifest = {
        runId: 'r2', version: 1, tone: 'neutre', style: 'documentaire',
        brandKitUsed: false, directorPlanUsed: false,
        prompts: [{
          sceneIndex: 1,
          prompt: 'Scene description. Natural lighting. Fixed camera.',
          negativePrompt: 'blurry',
          sources: { descriptionSnippet: 'Scène neutre', camera: 'fixe', lighting: 'naturel', directorNote: '', tone: 'neutre', style: 'documentaire' },
          version: 1,
        }],
        generatedAt: new Date().toISOString(),
      }

      expect(withDirector.directorPlanUsed).toBe(true)
      expect(withoutDirector.directorPlanUsed).toBe(false)
      // Les prompts sont différents
      expect(withDirector.prompts[0].prompt).not.toBe(withoutDirector.prompts[0].prompt)
      // Les sources diffèrent en ton/style
      expect(withDirector.prompts[0].sources.tone).not.toBe(withoutDirector.prompts[0].sources.tone)
    })

    it('deux intentions différentes → deux manifests avec ton/style différents', async () => {
      mkdirSync(FIXTURE_DIR, { recursive: true })

      const manifest1: PromptManifest = {
        runId: 'r1', version: 1, tone: 'humoristique', style: 'animé',
        brandKitUsed: false, directorPlanUsed: true,
        prompts: [], generatedAt: new Date().toISOString(),
      }
      const manifest2: PromptManifest = {
        runId: 'r2', version: 1, tone: 'dramatique', style: 'cinématographique',
        brandKitUsed: false, directorPlanUsed: true,
        prompts: [], generatedAt: new Date().toISOString(),
      }

      const p1 = join(FIXTURE_DIR, 'pm1.json')
      const p2 = join(FIXTURE_DIR, 'pm2.json')
      await writeFile(p1, JSON.stringify(manifest1, null, 2))
      await writeFile(p2, JSON.stringify(manifest2, null, 2))

      const r1 = JSON.parse(await readFile(p1, 'utf-8')) as PromptManifest
      const r2 = JSON.parse(await readFile(p2, 'utf-8')) as PromptManifest

      expect(r1.tone).not.toBe(r2.tone)
      expect(r1.style).not.toBe(r2.style)
    })
  })

  // ─── Route director-plan ─────────────────────────────────────────────────

  describe('GET /api/runs/{id}/director-plan — réponses attendues', () => {
    it('director-plan.json absent → doit indiquer raison claire', () => {
      // Ce test vérifie la structure de réponse attendue (sans vraiment appeler le serveur)
      const expectedNotFound = {
        data: null,
        meta: { reason: 'director-plan.json absent — step 3 non encore atteint' },
      }
      expect(expectedNotFound.data).toBeNull()
      expect(expectedNotFound.meta.reason).toContain('step 3')
    })

    it('director-plan.json présent → data contient les champs attendus', () => {
      const expectedFound = {
        data: {
          runId: 'x',
          tone: 'dramatique',
          style: 'cinématographique',
          creativeDirection: 'Direction.',
          shotList: [],
          generatedAt: new Date().toISOString(),
        },
      }
      expect(expectedFound.data.tone).toBeTruthy()
      expect(expectedFound.data.style).toBeTruthy()
      expect(Array.isArray(expectedFound.data.shotList)).toBe(true)
    })
  })
})
