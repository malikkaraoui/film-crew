import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const FIXTURE_DIR = join(__dirname, '__fixtures__')

describe('Chaîne critique — parsing et cohérence', () => {
  describe('step-3-json parsing défensif', () => {
    it('parse un JSON valide avec fences markdown', () => {
      const raw = '```json\n{"title":"Test","scenes":[{"index":1}]}\n```'
      const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '')
      const match = cleaned.match(/\{[\s\S]*\}/)
      expect(match).not.toBeNull()
      const parsed = JSON.parse(match![0])
      expect(parsed.title).toBe('Test')
      expect(parsed.scenes).toHaveLength(1)
    })

    it('parse un JSON sans fences', () => {
      const raw = '{"title":"Direct","hook":"accroche","scenes":[]}'
      const match = raw.match(/\{[\s\S]*\}/)
      expect(match).not.toBeNull()
      expect(JSON.parse(match![0]).title).toBe('Direct')
    })

    it('échoue proprement sur une réponse sans JSON', () => {
      const raw = 'Voici ma réponse sans JSON valide'
      const match = raw.match(/\{[\s\S]*\}/)
      expect(match).toBeNull()
    })
  })

  describe('step-2-brainstorm validation brief', () => {
    it('détecte un brief vide', () => {
      const brief = {
        summary: '',
        sections: [
          { agent: 'lenny', content: '' },
          { agent: 'laura', content: '' },
        ],
      }
      const nonEmpty = brief.sections.filter(s => s.content.trim().length > 0)
      expect(brief.summary?.trim()).toBe('')
      expect(nonEmpty.length).toBe(0)
    })

    it('accepte un brief avec contenu', () => {
      const brief = {
        summary: 'Résumé de la réunion',
        sections: [
          { agent: 'lenny', content: 'Structure en 3 actes' },
          { agent: 'laura', content: '' },
          { agent: 'nael', content: 'Ton dramatique' },
        ],
      }
      const nonEmpty = brief.sections.filter(s => s.content.trim().length > 0)
      expect(nonEmpty.length).toBe(2)
      expect(brief.summary.trim().length).toBeGreaterThan(0)
    })
  })

  describe('manifests cohérence', () => {
    it('structure.json → storyboard manifest cohérent', () => {
      const structure = {
        title: 'Test',
        scenes: [
          { index: 1, description: 'Scène 1' },
          { index: 2, description: 'Scène 2' },
          { index: 3, description: 'Scène 3' },
        ],
      }
      const storyboard = {
        images: structure.scenes.map(s => ({
          sceneIndex: s.index,
          description: s.description,
          status: 'generated',
          filePath: `/tmp/scene-${s.index}.png`,
        })),
      }

      // Chaque scène a une entrée storyboard
      expect(storyboard.images.length).toBe(structure.scenes.length)
      for (const scene of structure.scenes) {
        const img = storyboard.images.find(i => i.sceneIndex === scene.index)
        expect(img).toBeDefined()
        expect(img!.description).toBe(scene.description)
      }
    })

    it('preview-manifest reflète la réalité (0 clips)', () => {
      const previewManifest = {
        clips: [],
        storyboardImages: ['/tmp/s1.png', '/tmp/s2.png'],
        hasStoryboard: true,
        readyForAssembly: false,
      }

      expect(previewManifest.readyForAssembly).toBe(false)
      expect(previewManifest.hasStoryboard).toBe(true)
      expect(previewManifest.storyboardImages.length).toBe(2)
    })
  })

  describe('step7Preview.execute — vrai appel', () => {
    beforeEach(() => {
      rmSync(FIXTURE_DIR, { recursive: true, force: true })
      mkdirSync(join(FIXTURE_DIR, 'storyboard'), { recursive: true })
      mkdirSync(join(FIXTURE_DIR, 'final'), { recursive: true })
    })

    afterAll(() => {
      rmSync(FIXTURE_DIR, { recursive: true, force: true })
    })

    it('produit un preview-manifest.json réel avec 0 clips et storyboard', async () => {
      // Setup : generation-manifest avec 0 clips
      writeFileSync(join(FIXTURE_DIR, 'generation-manifest.json'), JSON.stringify({
        clips: [],
        audioPath: null,
        generatedAt: new Date().toISOString(),
      }))

      // Setup : storyboard manifest avec 2 images "generated"
      const img1Path = join(FIXTURE_DIR, 'storyboard', 'scene-1.png')
      const img2Path = join(FIXTURE_DIR, 'storyboard', 'scene-2.png')
      writeFileSync(img1Path, 'fake-png-1')
      writeFileSync(img2Path, 'fake-png-2')
      writeFileSync(join(FIXTURE_DIR, 'storyboard', 'manifest.json'), JSON.stringify({
        images: [
          { sceneIndex: 1, description: 'Scène 1', filePath: img1Path, status: 'generated' },
          { sceneIndex: 2, description: 'Scène 2', filePath: img2Path, status: 'generated' },
        ],
      }))

      // Import dynamique pour éviter les side effects du module
      const { step7Preview } = await import('../steps/step-7-preview')

      const result = await step7Preview.execute({
        runId: 'test-preview',
        chainId: 'test-chain',
        idea: 'Test preview',
        brandKitPath: null,
        storagePath: FIXTURE_DIR,
        intentionPath: null,
        template: null,
      })

      expect(result.success).toBe(true)
      expect(result.costEur).toBe(0)
      expect(result.outputData).toMatchObject({
        validClipCount: 0,
        hasStoryboard: true,
        readyForAssembly: false,
      })

      // Vérifier le fichier preview-manifest.json
      const manifestPath = join(FIXTURE_DIR, 'preview-manifest.json')
      expect(existsSync(manifestPath)).toBe(true)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(manifest.clips).toHaveLength(0)
      expect(manifest.storyboardImages).toHaveLength(2)
      expect(manifest.hasStoryboard).toBe(true)
      expect(manifest.readyForAssembly).toBe(false)
      expect(manifest.concatPath).toBeNull()
    })
  })
})
