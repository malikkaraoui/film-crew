import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import type { PipelineStep, StepContext, StepResult } from '../types'
import type { DirectorPlan } from './step-3-json'
import { logger } from '@/lib/logger'

export type PromptManifestEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt: string
  /** Traçabilité : d'où vient ce prompt */
  sources: {
    descriptionSnippet: string
    camera: string
    lighting: string
    directorNote: string
    tone: string
    style: string
  }
  version: 1
}

export type PromptManifest = {
  runId: string
  version: 1
  tone: string
  style: string
  brandKitUsed: boolean
  directorPlanUsed: boolean
  prompts: PromptManifestEntry[]
  generatedAt: string
}

export const step5Prompts: PipelineStep = {
  name: 'Prompts Seedance',
  stepNumber: 5,

  async execute(ctx: StepContext): Promise<StepResult> {
    // Lire la structure JSON
    let structure: { tone?: string; style?: string; scenes: { index: number; description: string; dialogue: string; camera: string; lighting: string }[] }
    try {
      const raw = await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8')
      structure = JSON.parse(raw)
    } catch {
      return { success: false, costEur: 0, outputData: null, error: 'structure.json introuvable' }
    }

    // Lire le director-plan si disponible (10C)
    let directorPlan: DirectorPlan | null = null
    try {
      const raw = await readFile(join(ctx.storagePath, 'director-plan.json'), 'utf-8')
      directorPlan = JSON.parse(raw) as DirectorPlan
    } catch { /* pas de director-plan — mode dégradé */ }

    // Charger le Brand Kit pour le prompt anchoring
    let brandContext = ''
    let brandKitUsed = false
    if (ctx.brandKitPath) {
      try {
        const raw = await readFile(join(process.cwd(), ctx.brandKitPath, 'brand.json'), 'utf-8')
        const brand = JSON.parse(raw) as Record<string, string>
        brandContext = `\nBrand Kit — style: ${brand.style || 'N/A'}, palette: ${brand.palette || 'N/A'}, ton: ${brand.tone || 'N/A'}.`
        brandKitUsed = true
      } catch { /* pas de brand kit */ }
    }

    // Contexte directeur injecté dans le system prompt
    const directorContext = directorPlan
      ? `\nDirection créative : ${directorPlan.creativeDirection}\nTon : ${directorPlan.tone} | Style : ${directorPlan.style}`
      : ''

    // Contexte template injecté dans le system prompt (10D)
    const templateContext = ctx.template
      ? `\nTemplate : ${ctx.template.name} — prefix imposé : "${ctx.template.promptPrefix}"\nSous-titres : ${ctx.template.subtitleStyle}\nRythme visuel : ${ctx.template.rhythm}`
      : ''

    const { result } = await executeWithFailover(
      'llm',
      async (p) => {
        const llm = p as LLMProvider
        return llm.chat(
          [
            {
              role: 'system',
              content: `Tu es un Prompt Engineer vidéo cinématographique. Pour chaque scène, génère un prompt Seedance structuré en 4 couches :
1. Sujet + action (ce qui se passe visuellement)
2. Dialogue/son (narration ou ambiance sonore)
3. Audio environnemental (bruits d'ambiance)
4. Style + émotion (mood, esthétique, photographie)

Chaque prompt doit :
- Faire 60-100 mots
- Inclure 1 seul mouvement caméra
- Inclure le lighting obligatoire
- Être cinématographique, précis et générable par IA vidéo${brandContext}${directorContext}${templateContext}

Retourne un JSON : { "prompts": [{ "sceneIndex": 1, "prompt": "...", "negativePrompt": "..." }] }
Retourne UNIQUEMENT le JSON.`,
            },
            {
              role: 'user',
              content: `Scènes :\n${JSON.stringify(structure.scenes, null, 2)}`,
            },
          ],
          { temperature: 0.7, maxTokens: 3000 },
        )
      },
      ctx.runId,
    )

    let parsed: { prompts: { sceneIndex: number; prompt: string; negativePrompt: string }[] }
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/)
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(result.content)
    } catch {
      return {
        success: false,
        costEur: result.costEur,
        outputData: { raw: result.content },
        error: 'Impossible de parser les prompts Seedance',
      }
    }

    // Sauvegarder prompts.json (compat existante)
    await writeFile(
      join(ctx.storagePath, 'prompts.json'),
      JSON.stringify(parsed, null, 2),
    )

    // ── 10C — Prompt Manifest ───────────────────────────────────────────────
    // Artefact traçable : chaque prompt enrichi avec ses sources (scène, camera,
    // lighting, note directeur, ton, style). Permet de comprendre pourquoi
    // chaque prompt a été généré ainsi.

    const tone = directorPlan?.tone ?? structure.tone ?? 'non défini'
    const style = directorPlan?.style ?? structure.style ?? 'non défini'

    const manifest: PromptManifest = {
      runId: ctx.runId,
      version: 1,
      tone,
      style,
      brandKitUsed,
      directorPlanUsed: !!directorPlan,
      prompts: parsed.prompts.map((p) => {
        const scene = structure.scenes.find((s) => s.index === p.sceneIndex)
        const shotEntry = directorPlan?.shotList.find((s) => s.sceneIndex === p.sceneIndex)
        return {
          sceneIndex: p.sceneIndex,
          prompt: p.prompt,
          negativePrompt: p.negativePrompt,
          sources: {
            descriptionSnippet: scene?.description?.slice(0, 80) ?? '',
            camera: scene?.camera ?? 'fixe',
            lighting: scene?.lighting ?? 'naturel',
            directorNote: shotEntry?.intent?.slice(0, 80) ?? '',
            tone,
            style,
          },
          version: 1,
        }
      }),
      generatedAt: new Date().toISOString(),
    }

    await writeFile(
      join(ctx.storagePath, 'prompt-manifest.json'),
      JSON.stringify(manifest, null, 2),
    )

    logger.info({
      event: 'prompt_manifest_written',
      runId: ctx.runId,
      promptCount: manifest.prompts.length,
      directorPlanUsed: manifest.directorPlanUsed,
      brandKitUsed: manifest.brandKitUsed,
    })

    return {
      success: true,
      costEur: result.costEur,
      outputData: {
        ...parsed,
        manifest: {
          tone,
          style,
          promptCount: manifest.prompts.length,
          directorPlanUsed: manifest.directorPlanUsed,
        },
      },
    }
  },
}
