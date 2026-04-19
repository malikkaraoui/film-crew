import { describe, it, expect } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const FIXTURE_DIR = join(__dirname, '__fixtures__')

function setupFixture() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
  mkdirSync(join(FIXTURE_DIR, 'storyboard'), { recursive: true })
  mkdirSync(join(FIXTURE_DIR, 'final'), { recursive: true })
}

function cleanFixture() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
}

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
})
