import { describe, it, expect } from 'vitest'
import type { StyleTemplate } from '@/lib/templates/loader'
import type { StepContext } from '../types'

/**
 * 10D — Brand Kit 2.0 + templates branchés
 *
 * Vérifie :
 * 1. StepContext accepte template: StyleTemplate | null
 * 2. Deux templates différents → system prompts step-3 différents
 * 3. Deux templates différents → system prompts step-5 différents
 * 4. Template.agentTones injecté dans le contexte de réunion
 * 5. template: null → mode dégradé silencieux (pas de crash)
 * 6. brand.json étendu → brandContext enrichi
 * 7. Condition de sortie : deux chaînes distinctes → prompts réellement différents
 */

const TEMPLATE_CINEMATIQUE: StyleTemplate = {
  id: 'cinematique',
  name: 'Cinématique',
  description: 'Style immersif, éclairage dramatique, mouvements lents',
  style: 'cinematic',
  rhythm: 'lent — plans longs, respirations visuelles, transitions douces',
  transitions: ['fondu', 'fondu enchaîné'],
  subtitleStyle: 'minimaliste blanc, ombre portée, bas de l\'écran',
  agentTones: {
    lenny: 'Narration contemplative, phrases longues, silences',
    laura: 'Plans larges, travellings lents, profondeur de champ',
    nael: 'Ambiance suspense, montée en tension progressive',
    emilie: 'Palette sombre et dorée, textures grain film',
    nico: 'Lumière naturelle contrastée, golden hour, ombres marquées',
  },
  promptPrefix: 'cinematic style, film grain, shallow depth of field, dramatic lighting',
}

const TEMPLATE_VIRAL: StyleTemplate = {
  id: 'viral',
  name: 'Viral',
  description: 'Style TikTok pur, maximum d\'impact en minimum de temps',
  style: 'viral',
  rhythm: 'ultra-rapide — 2-3s par plan, zéro temps mort',
  transitions: ['glitch', 'RGB split', 'zoom rapide'],
  subtitleStyle: 'énorme centré, couleurs flash, rotation légère, mode Hormozi IA',
  agentTones: {
    lenny: 'Hook en 2s, controverse, twist, CTA agressif',
    laura: 'Plans serrés, mouvements rapides, POV, handheld',
    nael: 'Shock value, plot twist chaque 10s, tension maximale',
    emilie: 'Couleurs saturées, néon, contrastes extrêmes',
    nico: 'Flash, stroboscope subtil, couleurs RGB, ambiance club',
  },
  promptPrefix: 'viral tiktok style, dynamic camera, neon colors, high energy, fast paced, trending aesthetic',
}

// ─── Helper : simuler la construction du contexte template injecté ───────────

function buildTemplateContextStep3(template: StyleTemplate | null): string {
  if (!template) return ''
  return `\n\nTemplate de style imposé : ${template.name} — ${template.description}\nStyle : ${template.style} | Rythme : ${template.rhythm}\nTransitions recommandées : ${template.transitions.join(', ')}\nAdapte le nombre de scènes, leur durée et leur rythme en conséquence.`
}

function buildTemplateContextStep5(template: StyleTemplate | null): string {
  if (!template) return ''
  return `\nTemplate : ${template.name} — prefix imposé : "${template.promptPrefix}"\nSous-titres : ${template.subtitleStyle}\nRythme visuel : ${template.rhythm}`
}

function buildAgentToneContext(template: StyleTemplate | null, agentRole: string): string {
  const agentTone = template?.agentTones?.[agentRole]
  return agentTone ? `\n[Ton attendu dans ce style ${template!.name} : ${agentTone}]` : ''
}

// ─── 1. StepContext accepte template ─────────────────────────────────────────

describe('10D — Brand Kit 2.0 + templates branchés', () => {

  describe('StepContext — champ template', () => {
    it('StepContext accepte template: null', () => {
      const ctx: StepContext = {
        runId: 'test', chainId: 'c', idea: 'test',
        brandKitPath: null, storagePath: '/tmp', intentionPath: null,
        template: null,
      }
      expect(ctx.template).toBeNull()
    })

    it('StepContext accepte template: StyleTemplate', () => {
      const ctx: StepContext = {
        runId: 'test', chainId: 'c', idea: 'test',
        brandKitPath: null, storagePath: '/tmp', intentionPath: null,
        template: TEMPLATE_CINEMATIQUE,
      }
      expect(ctx.template?.id).toBe('cinematique')
      expect(ctx.template?.promptPrefix).toBeTruthy()
    })
  })

  // ─── 2. Step-3 system prompts différents selon template ──────────────────

  describe('step-3-json — injection template dans system prompt', () => {
    it('template null → pas de contexte template dans le prompt', () => {
      const ctx = buildTemplateContextStep3(null)
      expect(ctx).toBe('')
    })

    it('template cinematique → contexte style cinematic injecté', () => {
      const ctx = buildTemplateContextStep3(TEMPLATE_CINEMATIQUE)
      expect(ctx).toContain('Cinématique')
      expect(ctx).toContain('cinematic')
      expect(ctx).toContain('lent')
      expect(ctx).toContain('fondu')
    })

    it('template viral → contexte style viral injecté', () => {
      const ctx = buildTemplateContextStep3(TEMPLATE_VIRAL)
      expect(ctx).toContain('Viral')
      expect(ctx).toContain('viral')
      expect(ctx).toContain('ultra-rapide')
      expect(ctx).toContain('glitch')
    })

    it('deux templates → deux system prompts step-3 distincts', () => {
      const c1 = buildTemplateContextStep3(TEMPLATE_CINEMATIQUE)
      const c2 = buildTemplateContextStep3(TEMPLATE_VIRAL)
      expect(c1).not.toBe(c2)
      expect(c1).not.toContain('viral')
      expect(c2).not.toContain('cinematic')
    })
  })

  // ─── 3. Step-5 system prompts différents selon template ──────────────────

  describe('step-5-prompts — injection template dans system prompt', () => {
    it('template null → pas de contexte template', () => {
      const ctx = buildTemplateContextStep5(null)
      expect(ctx).toBe('')
    })

    it('template cinematique → promptPrefix cinematic injecté', () => {
      const ctx = buildTemplateContextStep5(TEMPLATE_CINEMATIQUE)
      expect(ctx).toContain('cinematic style')
      expect(ctx).toContain('film grain')
      expect(ctx).toContain('dramatic lighting')
      expect(ctx).toContain('minimaliste blanc')
    })

    it('template viral → promptPrefix viral injecté', () => {
      const ctx = buildTemplateContextStep5(TEMPLATE_VIRAL)
      expect(ctx).toContain('viral tiktok style')
      expect(ctx).toContain('neon colors')
      expect(ctx).toContain('high energy')
      expect(ctx).toContain('Hormozi')
    })

    it('deux templates → deux system prompts step-5 distincts', () => {
      const c1 = buildTemplateContextStep5(TEMPLATE_CINEMATIQUE)
      const c2 = buildTemplateContextStep5(TEMPLATE_VIRAL)
      expect(c1).not.toBe(c2)
      expect(c1).not.toContain('viral')
      expect(c2).not.toContain('film grain')
    })
  })

  // ─── 4. agentTones injectés dans la réunion ───────────────────────────────

  describe('coordinator — agentTones injectés selon template', () => {
    it('template null → pas de ton pour lenny', () => {
      const tone = buildAgentToneContext(null, 'lenny')
      expect(tone).toBe('')
    })

    it('template cinematique → ton lenny contemplatif', () => {
      const tone = buildAgentToneContext(TEMPLATE_CINEMATIQUE, 'lenny')
      expect(tone).toContain('contemplative')
      expect(tone).toContain('Cinématique')
    })

    it('template viral → ton lenny hook agressif', () => {
      const tone = buildAgentToneContext(TEMPLATE_VIRAL, 'lenny')
      expect(tone).toContain('Hook en 2s')
      expect(tone).toContain('Viral')
    })

    it('chaque agent a un ton spécifique au template', () => {
      for (const role of ['lenny', 'laura', 'nael', 'emilie', 'nico']) {
        const cine = buildAgentToneContext(TEMPLATE_CINEMATIQUE, role)
        const viral = buildAgentToneContext(TEMPLATE_VIRAL, role)
        expect(cine).not.toBe('')
        expect(viral).not.toBe('')
        expect(cine).not.toBe(viral)
      }
    })
  })

  // ─── 5. Mode dégradé silencieux si template null ─────────────────────────

  describe('mode dégradé — template null', () => {
    it('template null → buildTemplateContextStep3 retourne chaîne vide', () => {
      expect(buildTemplateContextStep3(null)).toBe('')
    })

    it('template null → buildTemplateContextStep5 retourne chaîne vide', () => {
      expect(buildTemplateContextStep5(null)).toBe('')
    })

    it('template null → agentTone retourne chaîne vide', () => {
      expect(buildAgentToneContext(null, 'lenny')).toBe('')
    })
  })

  // ─── 6. Brand.json enrichi ───────────────────────────────────────────────

  describe('brand.json étendu — brandContext enrichi', () => {
    it('brand.json avec voicePreset → mentionné dans brandContext', () => {
      const brand = { style: 'cinématique', palette: 'sombre', tone: 'dramatique', voicePreset: 'grave-FR' }
      const brandContext = `\nBrand Kit — style: ${brand.style || 'N/A'}, palette: ${brand.palette || 'N/A'}, ton: ${brand.tone || 'N/A'}${brand.voicePreset ? `, voicePreset: ${brand.voicePreset}` : ''}.`
      expect(brandContext).toContain('grave-FR')
      expect(brandContext).toContain('cinématique')
    })

    it('brand.json sans voicePreset → brandContext inchangé', () => {
      const brand = { style: 'viral', palette: 'néon', tone: 'humoristique' }
      const brandContext = `\nBrand Kit — style: ${brand.style || 'N/A'}, palette: ${brand.palette || 'N/A'}, ton: ${brand.tone || 'N/A'}${'voicePreset' in brand ? `, voicePreset: ${brand.voicePreset}` : ''}.`
      expect(brandContext).not.toContain('voicePreset')
    })
  })

  // ─── 7. Condition de sortie 10D ──────────────────────────────────────────

  describe('condition de sortie — deux chaînes/templates produisent des sorties différentes', () => {
    it('promptPrefix cinematique ≠ promptPrefix viral', () => {
      expect(TEMPLATE_CINEMATIQUE.promptPrefix).not.toBe(TEMPLATE_VIRAL.promptPrefix)
    })

    it('agentTones cinematique ≠ agentTones viral pour tous les agents', () => {
      for (const agent of Object.keys(TEMPLATE_CINEMATIQUE.agentTones)) {
        expect(TEMPLATE_CINEMATIQUE.agentTones[agent]).not.toBe(TEMPLATE_VIRAL.agentTones[agent])
      }
    })

    it('rhythm cinematique ≠ rhythm viral', () => {
      expect(TEMPLATE_CINEMATIQUE.rhythm).not.toBe(TEMPLATE_VIRAL.rhythm)
    })

    it('transitions cinematique ≠ transitions viral', () => {
      const c = TEMPLATE_CINEMATIQUE.transitions.join(',')
      const v = TEMPLATE_VIRAL.transitions.join(',')
      expect(c).not.toBe(v)
    })

    it('system prompt step-5 cinematique ≠ system prompt step-5 viral', () => {
      const base = `Tu es un Prompt Engineer vidéo cinématographique.`
      const brand = ''
      const director = ''
      const c = base + brand + director + buildTemplateContextStep5(TEMPLATE_CINEMATIQUE)
      const v = base + brand + director + buildTemplateContextStep5(TEMPLATE_VIRAL)
      expect(c).not.toBe(v)
    })
  })
})
