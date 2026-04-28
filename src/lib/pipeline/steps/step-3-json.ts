import { readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import type { MeetingBrief, MeetingSceneOutlineItem } from '@/types/agent'
import type { PipelineStep, StepContext, StepResult } from '../types'
import { logger } from '@/lib/logger'
import { getStepLlmConfig, readProjectConfig } from '@/lib/runs/project-config'
import { resolveLlmTarget } from '@/lib/llm/target'
import type { OutputConfig } from '@/types/run'
import type { DialogueScript } from '@/types/audio'
import { backfillSceneOutlineDialogue, extractBriefSceneDialogues, findScenesMissingDialogue, normalizeDialogueScenesWithFallback } from '@/lib/meeting/scene-dialogue'

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

type StructuredScene = {
  index: number
  description: string
  dialogue: string
  camera: string
  lighting: string
  duration_s: number
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && normalizeWhitespace(value) ? normalizeWhitespace(value) : fallback
}

function toPositiveInt(value: unknown, fallback = 5): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function applyOutputConfigLock(payload: Record<string, unknown>, outputConfig: OutputConfig | null | undefined): Record<string, unknown> {
  if (!outputConfig) return payload

  const rawScenes = Array.isArray(payload.scenes) ? payload.scenes.map(asRecord) : []
  return {
    ...payload,
    scenes: rawScenes.map((scene) => ({
      ...scene,
      duration_s: outputConfig.sceneDurationS,
    })),
    target_duration_s: outputConfig.fullVideoDurationS,
  }
}

function buildSceneFromOutline(
  outline: MeetingSceneOutlineItem,
  candidate?: Record<string, unknown>,
): StructuredScene {
  return {
    index: outline.index,
    description: toText(candidate?.description, outline.description),
    dialogue: toText(candidate?.dialogue, outline.dialogue),
    camera: toText(candidate?.camera, outline.camera),
    lighting: toText(candidate?.lighting, outline.lighting),
    duration_s: toPositiveInt(candidate?.duration_s, outline.duration_s),
  }
}

export function alignStructuredStoryToBriefOutline(
  payload: Record<string, unknown>,
  sceneOutline: MeetingSceneOutlineItem[],
): Record<string, unknown> {
  if (sceneOutline.length === 0) return payload

  const rawScenes = Array.isArray(payload.scenes) ? payload.scenes.map(asRecord) : []
  const alignedScenes = sceneOutline.map((outline, index) => {
    const byIndex = rawScenes.find((scene) => toPositiveInt(scene.index, -1) === outline.index)
    const fallback = rawScenes[index]
    return buildSceneFromOutline(outline, byIndex ?? fallback)
  })

  const currentTarget = typeof payload.target_duration_s === 'number' && Number.isFinite(payload.target_duration_s)
    ? payload.target_duration_s
    : null

  return {
    ...payload,
    scenes: alignedScenes,
    target_duration_s: currentTarget ?? alignedScenes.reduce((sum, scene) => sum + scene.duration_s, 0),
  }
}

const DIALOGUE_SCRIPT_SYSTEM_PROMPT = `Tu es un directeur d'écriture vocale. À partir d'un brief de réunion de production et d'un JSON structuré, tu produis un script dialogué complet et précis.

Retourne UNIQUEMENT un JSON valide sans markdown, conforme à ce schéma :
{
  "runId": "...",
  "language": "fr",
  "totalDurationTargetS": 90,
  "scenes": [
    {
      "sceneIndex": 1,
      "title": "titre court",
      "durationTargetS": 10,
      "lines": [
        {
          "lineIndex": 0,
          "speaker": "narrateur",
          "text": "texte exact de la réplique",
          "tone": "neutre",
          "pace": "normal",
          "emphasis": ["mot1", "mot2"],
          "estimatedDurationS": 3.5
        }
      ],
      "silences": [
        {
          "afterLineIndex": 0,
          "durationS": 1.5,
          "purpose": "suspense"
        }
      ],
      "stageDirections": "indications de jeu pour cette scène"
    }
  ]
}

Règles :
- chaque scène du JSON structuré doit avoir AU MOINS une ligne de dialogue ou narration
- le speaker est "narrateur" sauf si des personnages distincts sont identifiés
- tone : "neutre" | "urgent" | "intime" | "ironique" | "grave" | "enthousiaste" | "mystérieux"
- pace : "slow" | "normal" | "fast"
- emphasis : liste les 1-3 mots clés à accentuer dans chaque réplique
- estimatedDurationS : estime la durée de lecture orale (environ 3 mots/seconde)
- place des silences signifiants entre les répliques quand le rythme l'exige
- purpose des silences : "suspense" | "respiration" | "transition" | "impact"
- stageDirections : décris comment la voix doit être jouée dans cette scène
- la somme des durées (lines + silences) par scène doit approcher durationTargetS`

async function buildDialogueScript(
  ctx: StepContext,
  brief: MeetingBrief | null,
  structuredJson: Record<string, unknown>,
  llmTarget: { model: string; host?: string; headers?: Record<string, string> },
): Promise<{ script: DialogueScript | null; costEur: number }> {
  const scenes = Array.isArray(structuredJson.scenes) ? structuredJson.scenes.map(asRecord) : []
  if (scenes.length === 0) return { script: null, costEur: 0 }
  const dialogueByScene = extractBriefSceneDialogues(brief)

  // Extraire les sections audio du brief (sami, jade, remi, theo)
  const audioSections = brief?.sections
    ?.filter((s) => ['sami', 'jade', 'remi', 'theo'].includes(s.agent))
    ?.map((s) => `[${s.agent}] ${s.content}`)
    ?.join('\n\n') ?? ''

  const targetDuration = typeof structuredJson.target_duration_s === 'number'
    ? structuredJson.target_duration_s
    : scenes.reduce((sum: number, s) => sum + (typeof s.duration_s === 'number' ? s.duration_s : 5), 0)

  const userContent = [
    `Idée : ${ctx.idea}`,
    '',
    `JSON structuré (${scenes.length} scènes, ${targetDuration}s total) :`,
    JSON.stringify(structuredJson, null, 2).slice(0, 3000),
    '',
    audioSections ? `Intentions audio de la réunion :\n${audioSections}` : '',
    '',
    `runId : ${ctx.runId}`,
    `Langue : fr`,
    `Durée cible totale : ${targetDuration}s`,
    '',
    'Produis le script dialogué complet pour chaque scène.',
  ].filter(Boolean).join('\n')

  try {
    const { result } = await executeWithFailover(
      'llm',
      async (p) => {
        const llm = p as LLMProvider
        return llm.chat(
          [
            { role: 'system', content: DIALOGUE_SCRIPT_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          {
            temperature: 0.4,
            maxTokens: 3000,
            model: llmTarget.model,
            host: llmTarget.host,
            headers: llmTarget.headers,
          },
        )
      },
      ctx.runId,
    )

    let raw = result.content
    raw = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '')
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Aucun objet JSON trouvé dans la réponse dialogue_script')

    const parsed = JSON.parse(jsonMatch[0]) as DialogueScript

    // Validation minimale
    if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      throw new Error('dialogue_script.scenes vide ou absent')
    }

    parsed.scenes = normalizeDialogueScenesWithFallback({
      scenes: parsed.scenes,
      structuredScenes: scenes,
      dialogueByScene,
    })

    const missingDialogueScenes = findScenesMissingDialogue({
      scenes: parsed.scenes,
      structuredScenes: scenes,
      dialogueByScene,
    })
    if (missingDialogueScenes.length > 0) {
      throw new Error(`dialogue_script incomplet: scène(s) sans lignes ${missingDialogueScenes.join(', ')}`)
    }

    // Forcer runId et language
    parsed.runId = ctx.runId
    parsed.language = parsed.language || 'fr'
    parsed.totalDurationTargetS = parsed.totalDurationTargetS || targetDuration

    return {
      script: parsed,
      costEur: result.costEur,
    }
  } catch (error) {
    logger.warn({
      event: 'dialogue_script_generation_failed',
      runId: ctx.runId,
      error: (error as Error).message,
    })
    return { script: null, costEur: 0 }
  }
}

export const step3Json: PipelineStep = {
  name: 'JSON structuré',
  stepNumber: 3,

  async execute(ctx: StepContext): Promise<StepResult> {
    const projectConfig = await readProjectConfig(ctx.storagePath)
    const llmConfig = getStepLlmConfig(projectConfig, 3)
    const llmTarget = resolveLlmTarget(llmConfig?.mode ?? 'local', llmConfig?.model)
    const outputConfig = projectConfig?.outputConfig ?? null

    // Lire le brief produit par la réunion d'agents (step 2)
    let briefContent: string | null = null
    let brief: MeetingBrief | null = null
    try {
      briefContent = await readFile(join(ctx.storagePath, 'brief.json'), 'utf-8')
      brief = JSON.parse(briefContent) as MeetingBrief
    } catch {
      logger.warn({ event: 'brief_missing', runId: ctx.runId, fallback: 'ctx.idea' })
    }

    const sceneDialogueHints = extractBriefSceneDialogues(brief)
    const sceneOutline = backfillSceneOutlineDialogue(brief?.sceneOutline ?? [], sceneDialogueHints)

    // Construire le prompt utilisateur à partir du brief ou fallback sur l'idée brute
    const userContent = briefContent
      ? `Brief de la réunion de production :\n\n${briefContent}\n\n${sceneOutline.length > 0 ? `Découpage canonique scene par scene issu du brief (obligatoire, a reprendre 1:1 sans fusion, sans suppression, sans reordering) :\n${JSON.stringify(sceneOutline, null, 2)}\n\n` : ''}${outputConfig ? `Cadre verrouillé : vidéo entière ${outputConfig.fullVideoDurationS}s, ${outputConfig.sceneCount} scènes obligatoires, ${outputConfig.sceneDurationS}s par scène.\n\n` : ''}Transforme ce brief en JSON structuré pour la production. L'étape 3 vient en complément du brief : elle le rend canonique et exploitable, elle ne le simplifie pas.`
      : `[FALLBACK — brief absent, idée brute uniquement]\n\nIdée : ${ctx.idea}\n\n${outputConfig ? `Cadre verrouillé : vidéo entière ${outputConfig.fullVideoDurationS}s, ${outputConfig.sceneCount} scènes obligatoires, ${outputConfig.sceneDurationS}s par scène.\n\n` : ''}Transforme en JSON structuré pour la production.`

    // Contexte template injecté dans le system prompt (10D)
    const templateContext = ctx.template
      ? `\n\nTemplate de style imposé : ${ctx.template.name} — ${ctx.template.description}\nStyle : ${ctx.template.style} | Rythme : ${ctx.template.rhythm}\nTransitions recommandées : ${ctx.template.transitions.join(', ')}\nAdapte le nombre de scènes, leur durée et leur rythme en conséquence.`
      : ''
    const outputLockContext = outputConfig
      ? `\n\nCadre verrouillé de production :\n- vidéo entière = ${outputConfig.fullVideoDurationS}s\n- scènes obligatoires = ${outputConfig.sceneCount}\n- durée par scène = ${outputConfig.sceneDurationS}s\n- target_duration_s doit être ${outputConfig.fullVideoDurationS}`
      : ''

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
Règles importantes :
- si le brief contient déjà un découpage scène par scène, reprends exactement ce nombre de scènes et le même ordre
- l'étape 3 complète le brief, elle ne le résume pas
- chaque scène doit rester fidèle au brief tout en devenant exploitable en production
Retourne UNIQUEMENT le JSON, sans markdown ni explication.${templateContext}${outputLockContext}`,
            },
            {
              role: 'user',
              content: userContent,
            },
          ],
          {
            temperature: 0.5,
            maxTokens: 2048,
            model: llmTarget.model,
            host: llmTarget.host,
            headers: llmTarget.headers,
          },
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

    const rawSceneCount = Array.isArray(parsed.scenes) ? parsed.scenes.length : 0
    parsed = alignStructuredStoryToBriefOutline(parsed, sceneOutline)
    parsed = applyOutputConfigLock(parsed, outputConfig)
    const alignedSceneCount = Array.isArray(parsed.scenes) ? parsed.scenes.length : 0

    if (sceneOutline.length > 0 && rawSceneCount !== alignedSceneCount) {
      logger.warn({
        event: 'step3_scene_outline_reapplied',
        runId: ctx.runId,
        rawSceneCount,
        alignedSceneCount,
      })
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

    // ── Audio-First — Dialogue Script ──────────────────────────────────────
    // Extraire un script dialogué structuré exploitable par le TTS.
    // Le script est produit par un second appel LLM à partir du brief + structure.

    let dialogueScriptSummary: { sceneCount: number; lineCount: number } | null = null
    let totalCostEur = result.costEur

    const dialogueScriptResult = await buildDialogueScript(ctx, brief, parsed, llmTarget)
    totalCostEur += dialogueScriptResult.costEur

    const dialogueScript = dialogueScriptResult.script

    if (dialogueScript) {
      await writeFile(
        join(ctx.storagePath, 'dialogue_script.json'),
        JSON.stringify(dialogueScript, null, 2),
      )

      const lineCount = dialogueScript.scenes.reduce((sum, s) => sum + s.lines.length, 0)
      dialogueScriptSummary = {
        sceneCount: dialogueScript.scenes.length,
        lineCount,
      }

      logger.info({
        event: 'dialogue_script_written',
        runId: ctx.runId,
        sceneCount: dialogueScript.scenes.length,
        lineCount,
        totalDurationTargetS: dialogueScript.totalDurationTargetS,
      })
    } else {
      await rm(join(ctx.storagePath, 'dialogue_script.json'), { force: true }).catch(() => {})
    }

    return {
      success: true,
      costEur: totalCostEur,
      outputData: {
        ...parsed,
        llm: { mode: llmTarget.mode, model: llmTarget.model },
        sceneOutlineUsed: sceneOutline.length > 0,
        directorPlan: {
          tone,
          style,
          sceneCount: scenes.length,
          creativeDirection: directorPlan.creativeDirection,
        },
        dialogueScript: dialogueScriptSummary,
      },
    }
  },
}
