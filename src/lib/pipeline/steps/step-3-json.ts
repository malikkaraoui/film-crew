import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import type { PipelineStep, StepContext, StepResult } from '../types'
import { logger } from '@/lib/logger'

export type DirectorPlan = {
  runId: string
  idea: string
  tone: string
  style: string
  creativeDirection: string
  shotList: {
    sceneIndex: number
    intent: string
    camera: string
    emotion: string
    influencedBy: string[]
  }[]
  generatedAt: string
}

export const step3Json: PipelineStep = {
  name: 'JSON structuré',
  stepNumber: 3,

  async execute(ctx: StepContext): Promise<StepResult> {
    // Lire le brief produit par la réunion d'agents (step 2)
    let briefContent: string | null = null
    let brief: { sections?: { agent: string; title: string; content: string }[]; summary?: string } | null = null
    try {
      briefContent = await readFile(join(ctx.storagePath, 'brief.json'), 'utf-8')
      brief = JSON.parse(briefContent)
    } catch {
      logger.warn({ event: 'brief_missing', runId: ctx.runId, fallback: 'ctx.idea' })
    }

    // Construire le prompt utilisateur à partir du brief ou fallback sur l'idée brute
    const userContent = briefContent
      ? `Brief de la réunion de production :\n\n${briefContent}\n\nTransforme ce brief en JSON structuré pour la production.`
      : `[FALLBACK — brief absent, idée brute uniquement]\n\nIdée : ${ctx.idea}\n\nTransforme en JSON structuré pour la production.`

    const { result } = await executeWithFailover(
      'llm',
      async (p) => {
        const llm = p as LLMProvider
        return llm.chat(
          [
            {
              role: 'system',
              content: `Tu es un assistant de production vidéo. Transforme le brief de réunion en un document JSON structuré pour la production.
Le JSON doit contenir :
{
  "title": "titre de la vidéo",
  "hook": "phrase d'accroche (5-10 mots)",
  "scenes": [
    {
      "index": 1,
      "description": "description visuelle détaillée de la scène",
      "dialogue": "texte de la narration pour cette scène",
      "camera": "mouvement caméra (1 seul)",
      "lighting": "description éclairage",
      "duration_s": 10
    }
  ],
  "style": "style visuel global",
  "tone": "ton émotionnel",
  "target_duration_s": 90
}
Retourne UNIQUEMENT le JSON, sans markdown ni explication.`,
            },
            {
              role: 'user',
              content: userContent,
            },
          ],
          { temperature: 0.5, maxTokens: 2048 },
        )
      },
      ctx.runId,
    )

    // Toujours sauvegarder la réponse brute pour diagnostic
    await writeFile(join(ctx.storagePath, 'structure-raw.txt'), result.content)

    // Parser le JSON — nettoyage défensif pour qwen3.5:4b
    let parsed: Record<string, unknown>
    try {
      let raw = result.content
      // Retirer les fences markdown ```json ... ```
      raw = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '')
      // Extraire le premier objet JSON
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Aucun objet JSON trouvé dans la réponse')
      parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    } catch (e) {
      return {
        success: false,
        costEur: result.costEur,
        outputData: { raw: result.content },
        error: `Parsing JSON échoué: ${(e as Error).message}. Réponse brute conservée dans structure-raw.txt`,
      }
    }

    const outputPath = join(ctx.storagePath, 'structure.json')
    await writeFile(outputPath, JSON.stringify(parsed, null, 2))

    // ── 10C — Director Plan ─────────────────────────────────────────────────
    // Construire le plan du réalisateur à partir de structure.json + brief
    // Ce plan est l'artefact intermédiaire explicite : chaque scène y est documentée
    // avec son intention créative, son plan caméra et son ancrage dans le brief.

    const scenes = (parsed.scenes as { index: number; description: string; camera: string; dialogue: string }[]) ?? []
    const tone = (parsed.tone as string) ?? 'non défini'
    const style = (parsed.style as string) ?? 'non défini'

    // Traçabilité : quels agents du brief ont influencé quoi
    const briefAgents = brief?.sections?.map((s) => s.agent) ?? []
    const narrativeAgents = briefAgents.filter((a) => ['lenny', 'nael'].includes(a))
    const cameraAgents = briefAgents.filter((a) => ['laura', 'nico'].includes(a))

    const directorPlan: DirectorPlan = {
      runId: ctx.runId,
      idea: ctx.idea,
      tone,
      style,
      creativeDirection: brief?.summary
        ? `${brief.summary.slice(0, 200)}…`
        : `Production ${tone} en style ${style}.`,
      shotList: scenes.map((scene) => ({
        sceneIndex: scene.index,
        intent: scene.description?.slice(0, 120) ?? '',
        camera: scene.camera ?? 'fixe',
        emotion: tone,
        influencedBy: scene.index === 1
          ? [...narrativeAgents, ...cameraAgents]
          : narrativeAgents.length > 0 ? narrativeAgents : ['structure'],
      })),
      generatedAt: new Date().toISOString(),
    }

    await writeFile(
      join(ctx.storagePath, 'director-plan.json'),
      JSON.stringify(directorPlan, null, 2),
    )

    logger.info({
      event: 'director_plan_written',
      runId: ctx.runId,
      sceneCount: scenes.length,
      tone,
      style,
    })

    return {
      success: true,
      costEur: result.costEur,
      outputData: {
        ...parsed,
        directorPlan: {
          tone,
          style,
          sceneCount: scenes.length,
          creativeDirection: directorPlan.creativeDirection,
        },
      },
    }
  },
}
