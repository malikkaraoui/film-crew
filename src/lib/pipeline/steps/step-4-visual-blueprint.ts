import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import type { PipelineStep, StepContext, StepResult } from '../types'
import type { DirectorPlan } from './step-3-json'
import {
  buildStoryboardBlueprintFallback,
  normalizeStoryboardBlueprint,
  parseStoryboardBlueprintJson,
  type BriefDocument,
  type StructuredStoryDocument,
} from '@/lib/storyboard/blueprint'
import { logger } from '@/lib/logger'
import { getStepLlmConfig, readProjectConfig } from '@/lib/runs/project-config'
import { resolveLlmTarget } from '@/lib/llm/target'

export const step4VisualBlueprint: PipelineStep = {
  name: 'Blueprint visuel',
  stepNumber: 4,

  async execute(ctx: StepContext): Promise<StepResult> {
    const projectConfig = await readProjectConfig(ctx.storagePath)
    const llmConfig = getStepLlmConfig(projectConfig, 4)
    const llmTarget = resolveLlmTarget(llmConfig?.mode ?? 'cloud', llmConfig?.model)

    let structure: StructuredStoryDocument
    try {
      const raw = await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8')
      structure = JSON.parse(raw) as StructuredStoryDocument
    } catch {
      return {
        success: false,
        costEur: 0,
        outputData: null,
        error: 'structure.json introuvable — impossible de fabriquer le blueprint visuel',
      }
    }

    let brief: BriefDocument | null = null
    try {
      const raw = await readFile(join(ctx.storagePath, 'brief.json'), 'utf-8')
      brief = JSON.parse(raw) as BriefDocument
    } catch {
      brief = null
    }

    let directorPlan: DirectorPlan | null = null
    try {
      const raw = await readFile(join(ctx.storagePath, 'director-plan.json'), 'utf-8')
      directorPlan = JSON.parse(raw) as DirectorPlan
    } catch {
      directorPlan = null
    }

    const blueprintPath = join(ctx.storagePath, 'storyboard-blueprint.json')
    const rawBlueprintPath = join(ctx.storagePath, 'storyboard-blueprint-raw.txt')

    let costEur = 0
    let providerUsed = 'heuristic-fallback'
    let failoverOccurred = false
    let source: 'llm' | 'fallback' = 'fallback'
    let fallbackReason: string | null = null
    let rawContent: string | null = null

    const generatedAt = new Date().toISOString()

    try {
      const { result, provider, failover } = await executeWithFailover(
        'llm',
        async (p) => {
          const llm = p as LLMProvider
          return llm.chat(
            [
              { role: 'system', content: buildSystemPrompt() },
              { role: 'user', content: buildUserPrompt(ctx.idea, structure, brief, directorPlan) },
            ],
            {
              temperature: 0.3,
              maxTokens: 3200,
              model: llmTarget.model,
              host: llmTarget.host,
              headers: llmTarget.headers,
            },
          )
        },
        ctx.runId,
      )

      costEur = result.costEur
      providerUsed = provider.name
      failoverOccurred = !!failover
      source = 'llm'
      rawContent = result.content

      await writeFile(rawBlueprintPath, result.content)

      const payload = parseStoryboardBlueprintJson(result.content)
      const blueprint = normalizeStoryboardBlueprint(payload, {
        runId: ctx.runId,
        idea: ctx.idea,
        structure,
        directorPlan,
        brief,
        source,
        providerUsed,
        failoverOccurred,
        generatedAt,
      })

      await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2))

      logger.info({
        event: 'visual_blueprint_written',
        runId: ctx.runId,
        source,
        providerUsed,
        sceneCount: blueprint.scenes.length,
      })

      return {
        success: true,
        costEur,
        outputData: {
          sceneCount: blueprint.scenes.length,
          source,
          llm: { mode: llmTarget.mode, model: llmTarget.model },
          providerUsed,
          failoverOccurred,
          creativeDirection: blueprint.creativeDirection,
        },
      }
    } catch (error) {
      fallbackReason = (error as Error).message
      logger.warn({
        event: 'visual_blueprint_fallback',
        runId: ctx.runId,
        error: fallbackReason,
      })
    }

    const blueprint = buildStoryboardBlueprintFallback({
      runId: ctx.runId,
      idea: ctx.idea,
      structure,
      directorPlan,
      brief,
      generatedAt,
    })

    await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2))
    if (rawContent && !fallbackReason) {
      await writeFile(rawBlueprintPath, rawContent)
    }

    return {
      success: true,
      costEur,
      outputData: {
        sceneCount: blueprint.scenes.length,
        source: blueprint.source,
        llm: { mode: llmTarget.mode, model: llmTarget.model },
        providerUsed: blueprint.providerUsed,
        failoverOccurred: blueprint.failoverOccurred,
        creativeDirection: blueprint.creativeDirection,
        fallbackReason,
      },
    }
  },
}

function buildSystemPrompt(): string {
  return [
    'Tu es l agent dedie au blueprint visuel de FILM-CREW.',
    'Ta mission est de transformer une structure narrative en plan de dessin scene par scene.',
    'Le rendu cible est un rough storyboard noir et blanc, tres simple, lisible, dessinable par un enfant de 10 ans au feutre noir.',
    'Tu reduis la complexite visuelle. Tu preferes un sujet principal, une action lisible, un decor minimal, des objets simples et des indications concretes.',
    'Tu reponds uniquement avec un JSON valide, sans markdown, sans texte autour.',
    'Schema attendu :',
    '{',
    '  "title": "titre court",',
    '  "tone": "ton visuel",',
    '  "style": "style rough simple",',
    '  "creativeDirection": "ligne directrice concise",',
    '  "scenes": [',
    '    {',
    '      "sceneIndex": 1,',
    '      "panelTitle": "titre tres court",',
    '      "childCaption": "phrase simple qui explique la scene",',
    '      "primarySubject": "sujet principal",',
    '      "action": "action principale",',
    '      "background": "decor minimum",',
    '      "framing": "cadrage simple",',
    '      "lighting": "ambiance lumineuse simple",',
    '      "simpleShapes": ["formes faciles a dessiner"],',
    '      "importantObjects": ["objets importants"],',
    '      "drawingSteps": ["etapes courtes de dessin"],',
    '      "kidNotes": ["indices tres simples"],',
    '      "directorIntent": "intention courte",',
    '      "emotion": "emotion dominante",',
    '      "influencedBy": ["agents ou structure"]',
    '    }',
    '  ]',
    '}',
    'Contraintes : pas de jargon inutile, caption courte, 2 a 4 drawingSteps, 0 a 5 objets max, toujours choisir la version la plus simple a dessiner.',
  ].join('\n')
}

function buildUserPrompt(
  idea: string,
  structure: StructuredStoryDocument,
  brief: BriefDocument | null,
  directorPlan: DirectorPlan | null,
): string {
  const compactSceneOutline = brief?.sceneOutline
    ? brief.sceneOutline.map((scene) => ({
        index: scene.index,
        title: scene.title,
        description: scene.description,
        dialogue: scene.dialogue,
        camera: scene.camera,
        lighting: scene.lighting,
        duration_s: scene.duration_s,
        emotion: scene.emotion,
        narrativeRole: scene.narrativeRole,
      }))
    : null

  const compactBrief = brief
    ? {
        summary: brief.summary ?? '',
        sections: (brief.sections ?? []).map((section) => ({
          agent: section.agent,
          title: section.title ?? '',
          content: section.content.slice(0, 500),
        })),
      }
    : null

  const compactStructure = {
    title: structure.title ?? idea,
    hook: structure.hook ?? '',
    tone: structure.tone ?? '',
    style: structure.style ?? '',
    target_duration_s: structure.target_duration_s ?? null,
    scenes: structure.scenes.map((scene) => ({
      index: scene.index,
      description: scene.description,
      dialogue: scene.dialogue,
      camera: scene.camera,
      lighting: scene.lighting,
      duration_s: scene.duration_s,
    })),
  }

  const compactDirectorPlan = directorPlan
    ? {
        tone: directorPlan.tone,
        style: directorPlan.style,
        creativeDirection: directorPlan.creativeDirection,
        shotList: directorPlan.shotList,
      }
    : null

  return [
    `idea: ${idea}`,
    '',
    'brief_json:',
    JSON.stringify(compactBrief, null, 2),
    '',
    'brief_scene_outline_json:',
    JSON.stringify(compactSceneOutline, null, 2),
    '',
    'structure_json:',
    JSON.stringify(compactStructure, null, 2),
    '',
    'director_plan_json:',
    JSON.stringify(compactDirectorPlan, null, 2),
    '',
    'Rappel : ce blueprint servira d abord au renderer rough local, puis a un enrichissement cloud. Il faut donc un plan tres concret, tres simple, et scene par scene.',
  ].join('\n')
}