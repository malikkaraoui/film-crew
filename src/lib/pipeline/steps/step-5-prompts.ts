import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import type { PipelineStep, StepContext, StepResult } from '../types'
import type { DirectorPlan } from './step-3-json'
import { logger } from '@/lib/logger'
import {
  getBlueprintScene,
  readStoryboardBlueprint,
  type StructuredStoryDocument,
} from '@/lib/storyboard/blueprint'
import { getStepLlmConfig, readProjectConfig } from '@/lib/runs/project-config'
import { resolveLlmTarget } from '@/lib/llm/target'
import {
  buildProviderPromptVariants,
  buildVideoPromptSystemRules,
  resolveProviderPrompt,
  type ProviderPromptMap,
} from '@/lib/pipeline/provider-prompting'

type BriefSceneOutlineItem = {
  index: number
  title?: string
  description?: string
  dialogue?: string
  camera?: string
  lighting?: string
  duration_s?: number
  foreground?: string
  midground?: string
  background?: string
  emotion?: string
  narrativeRole?: string
}

type BriefDocument = {
  summary?: string
  sceneOutline?: BriefSceneOutlineItem[]
}

type GeneratedPromptFields = {
  sceneIndex: number
  subject: string
  action: string
  environment: string
  foreground: string
  midground: string
  background: string
  camera: string
  lighting: string
  motion: string
  framing: string
  mood: string
  style: string
  audio?: string
  dialogue?: string
  mustKeep?: string[]
  negativePrompt: string
}

export type PromptManifestEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt: string
  providerPrompts?: ProviderPromptMap
  promptStructure?: {
    subject: string
    action: string
    environment: string
    foreground: string
    midground: string
    background: string
    camera: string
    lighting: string
    motion: string
    framing: string
    mood: string
    style: string
    audio?: string
    dialogue?: string
    mustKeep?: string[]
  }
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

type NormalizedPromptEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt: string
  providerPrompts: ProviderPromptMap
  promptStructure: NonNullable<PromptManifestEntry['promptStructure']>
}

type RawGeneratedPromptEntry = Partial<GeneratedPromptFields> & {
  sceneIndex: number
  negativePrompt?: string
}

export const step5Prompts: PipelineStep = {
  name: 'Prompts Seedance',
  stepNumber: 7,

  async execute(ctx: StepContext): Promise<StepResult> {
    const projectConfig = await readProjectConfig(ctx.storagePath)
    const llmConfig = getStepLlmConfig(projectConfig, 6)
    const llmTarget = resolveLlmTarget(llmConfig?.mode ?? 'local', llmConfig?.model)
    const referenceImageUrls = projectConfig?.referenceImages?.urls ?? []

    let structure: StructuredStoryDocument
    try {
      const raw = await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8')
      structure = JSON.parse(raw) as StructuredStoryDocument
    } catch {
      return { success: false, costEur: 0, outputData: null, error: 'structure.json introuvable' }
    }

    let brief: BriefDocument | null = null
    try {
      const raw = await readFile(join(ctx.storagePath, 'brief.json'), 'utf-8')
      brief = JSON.parse(raw) as BriefDocument
    } catch { /* pas de brief exploitable */ }

    let directorPlan: DirectorPlan | null = null
    try {
      const raw = await readFile(join(ctx.storagePath, 'director-plan.json'), 'utf-8')
      directorPlan = JSON.parse(raw) as DirectorPlan
    } catch { /* mode dégradé */ }

    const blueprint = await readStoryboardBlueprint(ctx.storagePath)

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

    const directorContext = directorPlan
      ? `\nDirection créative : ${directorPlan.creativeDirection}\nTon : ${directorPlan.tone} | Style : ${directorPlan.style}`
      : ''

    const templateContext = ctx.template
      ? `\nTemplate : ${ctx.template.name} — prefix imposé : "${ctx.template.promptPrefix}"\nSous-titres : ${ctx.template.subtitleStyle}\nRythme visuel : ${ctx.template.rhythm}`
      : ''

    const { result } = await executeWithFailover(
      'llm',
      async (provider) => {
        const llm = provider as LLMProvider
        return llm.chat(
          [
            {
              role: 'system',
              content: `Tu es un Prompt Engineer vidéo senior orienté production.
Tu ne rédiges PAS des prompts littéraires flous. Tu fabriques des prompts opérables comme un professionnel de préproduction IA vidéo.

OBJECTIF : pour chaque scène, produire une structure de prompt ultra exploitable, ancrée dans la réunion, la structure canonique, le blueprint et la direction créative.

RÈGLES IMPÉRATIVES :
- un seul sujet principal visuel ;
- une seule action principale ;
- un seul mouvement caméra ;
- lighting obligatoire ;
- composition pensée nativement pour TikTok vertical 9:16 ;
- environnement réel obligatoire avec profondeur lisible ;
- décris explicitement foreground, midground, background ;
- interdiction de fond studio, fond neutre, fond vide, fond seamless, cyclorama, sujet isolé hors contexte ;
- pas de répétition inutile ;
- pas d'abstraction vague type "beautiful cinematic masterpiece" ;
- pas de contradictions ;
- priorité absolue à la clarté de génération, pas au style rédactionnel ;
- si une donnée de réunion/structure est forte, tu la gardes telle quelle.

${buildVideoPromptSystemRules()}

LONGUEUR CIBLE : 45 à 80 mots maximum pour le prompt final.
NEGATIVE PROMPT : court, concret, anti-déchets visuels.

Retourne UNIQUEMENT un JSON valide contenant pour chaque scène :
sceneIndex, subject, action, environment, foreground, midground, background, camera, lighting, motion, framing, mood, style, audio, dialogue, mustKeep, negativePrompt.
${brandContext}${directorContext}${templateContext}`,
            },
            {
              role: 'user',
              content: `Brief réunion :
${JSON.stringify({
                summary: brief?.summary ?? '',
                sceneOutline: brief?.sceneOutline ?? [],
                referenceImages: referenceImageUrls,
              }, null, 2)}

Scènes source :
${JSON.stringify(structure.scenes.map((scene) => {
                const blueprintScene = getBlueprintScene(blueprint, scene.index)
                const shotEntry = directorPlan?.shotList.find((entry) => entry.sceneIndex === scene.index)
                const briefScene = brief?.sceneOutline?.find((entry) => entry.index === scene.index)
                return {
                  ...scene,
                  briefAnchor: briefScene
                    ? {
                        title: briefScene.title,
                        description: briefScene.description,
                        dialogue: briefScene.dialogue,
                        camera: briefScene.camera,
                        lighting: briefScene.lighting,
                        foreground: briefScene.foreground,
                        midground: briefScene.midground,
                        background: briefScene.background,
                        duration_s: briefScene.duration_s,
                        emotion: briefScene.emotion,
                        narrativeRole: briefScene.narrativeRole,
                      }
                    : null,
                  storyboardBlueprint: blueprintScene
                    ? {
                        panelTitle: blueprintScene.panelTitle,
                        childCaption: blueprintScene.childCaption,
                        primarySubject: blueprintScene.primarySubject,
                        action: blueprintScene.action,
                        background: blueprintScene.background,
                        framing: blueprintScene.framing,
                        lighting: blueprintScene.lighting,
                        emotion: blueprintScene.emotion,
                      }
                    : null,
                  directorIntent: shotEntry?.intent ?? '',
                }
              }), null, 2)}`,
            },
          ],
          {
            temperature: 0.25,
            maxTokens: 3000,
            model: llmTarget.model,
            host: llmTarget.host,
            headers: llmTarget.headers,
          },
        )
      },
      ctx.runId,
    )

    let parsedPrompts: RawGeneratedPromptEntry[]
    try {
      parsedPrompts = extractPromptEntriesFromLlmResponse(result.content)
    } catch {
      return {
        success: false,
        costEur: result.costEur,
        outputData: { raw: result.content },
        error: 'Impossible de parser les prompts Seedance',
      }
    }

    if (parsedPrompts.length === 0) {
      logger.warn({
        event: 'prompt_generation_empty_llm_payload',
        runId: ctx.runId,
        message: 'Fallback déterministe activé pour les prompts vidéo',
      })
      parsedPrompts = structure.scenes.map((scene) => ({ sceneIndex: scene.index }))
    }

    const normalizedPrompts: NormalizedPromptEntry[] = structure.scenes.map((scene) => {
      const rawPrompt = parsedPrompts.find((entry) => entry.sceneIndex === scene.index) ?? { sceneIndex: scene.index }
      const blueprintScene = getBlueprintScene(blueprint, scene.index)
      const shotEntry = directorPlan?.shotList.find((entry) => entry.sceneIndex === scene.index)
      const briefScene = brief?.sceneOutline?.find((entry) => entry.index === scene.index)

      return normalizeGeneratedPrompt({
        raw: rawPrompt,
        scene,
        blueprintScene,
        briefScene,
        directorIntent: shotEntry?.intent ?? '',
        tone: directorPlan?.tone ?? structure.tone ?? '',
        style: directorPlan?.style ?? structure.style ?? '',
        hasReferenceImage: referenceImageUrls.length > 0,
      })
    })

    await writeFile(
      join(ctx.storagePath, 'prompts.json'),
      JSON.stringify({
        prompts: normalizedPrompts.map((entry) => ({
          sceneIndex: entry.sceneIndex,
          prompt: entry.prompt,
          negativePrompt: entry.negativePrompt,
          providerPrompts: entry.providerPrompts,
        })),
      }, null, 2),
    )

    const tone = directorPlan?.tone ?? structure.tone ?? 'non défini'
    const style = directorPlan?.style ?? structure.style ?? 'non défini'

    const manifest: PromptManifest = {
      runId: ctx.runId,
      version: 1,
      tone,
      style,
      brandKitUsed,
      directorPlanUsed: !!directorPlan,
      prompts: normalizedPrompts.map((entry) => {
        const scene = structure.scenes.find((candidate) => candidate.index === entry.sceneIndex)
        const shotEntry = directorPlan?.shotList.find((candidate) => candidate.sceneIndex === entry.sceneIndex)
        const blueprintScene = getBlueprintScene(blueprint, entry.sceneIndex)

        return {
          sceneIndex: entry.sceneIndex,
          prompt: entry.prompt,
          negativePrompt: entry.negativePrompt,
          providerPrompts: entry.providerPrompts,
          promptStructure: entry.promptStructure,
          sources: {
            descriptionSnippet: blueprintScene?.childCaption?.slice(0, 80) ?? scene?.description?.slice(0, 80) ?? '',
            camera: blueprintScene?.framing ?? scene?.camera ?? 'fixe',
            lighting: blueprintScene?.lighting ?? scene?.lighting ?? 'naturel',
            directorNote: blueprintScene?.directorIntent?.slice(0, 80) ?? shotEntry?.intent?.slice(0, 80) ?? '',
            tone,
            style,
          },
          version: 1,
        }
      }),
      generatedAt: new Date().toISOString(),
    }

    await writeFile(join(ctx.storagePath, 'prompt-manifest.json'), JSON.stringify(manifest, null, 2))

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
        prompts: normalizedPrompts.map((entry) => ({
          sceneIndex: entry.sceneIndex,
          prompt: entry.prompt,
          negativePrompt: entry.negativePrompt,
        })),
        llm: { mode: llmTarget.mode, model: llmTarget.model },
        manifest: {
          tone,
          style,
          promptCount: manifest.prompts.length,
          directorPlanUsed: manifest.directorPlanUsed,
          blueprintUsed: Boolean(blueprint?.scenes.length),
        },
      },
    }
  },
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function toSceneIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function extractJsonPayload(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Réponse LLM vide')

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) {
    return JSON.parse(fenced[1].trim()) as unknown
  }

  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as unknown
  }

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as unknown
  }

  const firstArray = trimmed.match(/\[[\s\S]*\]/)
  if (firstArray) {
    return JSON.parse(firstArray[0]) as unknown
  }

  const firstObject = trimmed.match(/\{[\s\S]*\}/)
  if (firstObject) {
    return JSON.parse(firstObject[0]) as unknown
  }

  return JSON.parse(trimmed) as unknown
}

export function extractPromptEntriesFromLlmResponse(content: string): RawGeneratedPromptEntry[] {
  const payload = extractJsonPayload(content)

  const rawEntries = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { prompts?: unknown }).prompts)
      ? (payload as { prompts: unknown[] }).prompts
      : []

  return rawEntries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const sceneIndex = toSceneIndex((entry as { sceneIndex?: unknown }).sceneIndex)
      if (!sceneIndex) return null
      return {
        ...(entry as Omit<RawGeneratedPromptEntry, 'sceneIndex'>),
        sceneIndex,
      }
    })
    .filter((entry): entry is RawGeneratedPromptEntry => entry !== null)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : []
}

function compactParts(parts: Array<string | null | undefined>): string {
  return parts.map((part) => normalizeText(part)).filter(Boolean).join(', ')
}

function buildProfessionalPrompt(input: NormalizedPromptEntry['promptStructure']): string {
  const parts = [
    compactParts([input.style, input.framing]),
    `${input.subject}, ${input.action}`,
    `foreground: ${input.foreground}`,
    `midground: ${input.midground}`,
    `background: ${input.background}`,
    input.environment,
    compactParts([input.camera, input.motion]),
    input.lighting,
    input.audio ? `audio ambience: ${input.audio}` : '',
    input.dialogue ? `dialogue cue: ${input.dialogue}` : '',
    input.mood,
    input.mustKeep?.length ? `must keep: ${input.mustKeep.join(', ')}` : '',
  ].filter(Boolean)

  return parts.join('. ').replace(/\.\./g, '.').trim()
}

function buildFallbackNegativePrompt(sceneDescription: string): string {
  const hints = ['cartoon', 'low detail', 'oversaturated', 'clean futuristic city', 'smiling heroic pose', 'studio background', 'empty backdrop', 'seamless background', 'white cyclorama', 'gray studio floor', 'isolated product shot', 'landscape framing', 'horizontal composition']
  if (/night|nuit|brume|mist/i.test(sceneDescription)) hints.push('bright daylight')
  if (/war|guerre|soldat|robot/i.test(sceneDescription)) hints.push('comedic mood')
  return hints.join(', ')
}

function buildLayerFallback(args: {
  rawValue: unknown
  briefValue?: unknown
  blueprintValue?: unknown
  sceneDescription: string
  label: 'foreground' | 'midground' | 'background'
}): string {
  const rawText = normalizeText(args.rawValue)
  if (rawText) return rawText

  const briefText = normalizeText(args.briefValue)
  if (briefText) return briefText

  const blueprintText = normalizeText(args.blueprintValue)
  if (blueprintText) return blueprintText

  if (args.label === 'foreground') {
    return `grounded near-camera subject details tied to: ${normalizeText(args.sceneDescription) || 'the main action'}`
  }

  if (args.label === 'midground') {
    return `action space with terrain, props, bodies or machinery tied to: ${normalizeText(args.sceneDescription) || 'the scene'}`
  }

  return `distant real background with depth, horizon, structures, smoke, weather or landscape tied to: ${normalizeText(args.sceneDescription) || 'the scene'}`
}

function normalizeGeneratedPrompt(args: {
  raw: Partial<GeneratedPromptFields> & { sceneIndex: number; negativePrompt?: string }
  scene: StructuredStoryDocument['scenes'][number]
  blueprintScene: ReturnType<typeof getBlueprintScene>
  briefScene?: BriefSceneOutlineItem
  directorIntent: string
  tone: string
  style: string
  hasReferenceImage: boolean
}): NormalizedPromptEntry {
  const { raw, scene, blueprintScene, briefScene, directorIntent, tone, style, hasReferenceImage } = args

  const subject = normalizeText(raw.subject)
    || normalizeText(blueprintScene?.primarySubject)
    || normalizeText(briefScene?.title)
    || 'main subject in frame'

  const action = normalizeText(raw.action)
    || normalizeText(blueprintScene?.action)
    || normalizeText(briefScene?.description)
    || normalizeText(scene.description)

  const environment = normalizeText(raw.environment)
    || compactParts([
      blueprintScene?.background,
      briefScene?.narrativeRole,
      scene.description,
    ])

  const foreground = buildLayerFallback({
    rawValue: raw.foreground,
    briefValue: briefScene?.foreground,
    blueprintValue: blueprintScene?.primarySubject,
    sceneDescription: scene.description,
    label: 'foreground',
  })

  const midground = buildLayerFallback({
    rawValue: raw.midground,
    briefValue: briefScene?.midground,
    blueprintValue: blueprintScene?.action,
    sceneDescription: scene.description,
    label: 'midground',
  })

  const background = buildLayerFallback({
    rawValue: raw.background,
    briefValue: briefScene?.background,
    blueprintValue: blueprintScene?.background,
    sceneDescription: scene.description,
    label: 'background',
  })

  const camera = normalizeText(raw.camera)
    || normalizeText(briefScene?.camera)
    || normalizeText(scene.camera)
    || 'controlled cinematic camera'

  const lighting = normalizeText(raw.lighting)
    || normalizeText(briefScene?.lighting)
    || normalizeText(scene.lighting)
    || normalizeText(blueprintScene?.lighting)
    || 'motivated dramatic lighting'

  const motion = normalizeText(raw.motion)
    || normalizeText(scene.camera)
    || 'single slow controlled movement'

  const framing = normalizeText(raw.framing)
    || normalizeText(blueprintScene?.framing)
    || normalizeText(briefScene?.camera)
    || 'cinematic framing'

  const mood = normalizeText(raw.mood)
    || compactParts([briefScene?.emotion, blueprintScene?.emotion, directorIntent, tone])
    || 'controlled cinematic tension'

  const resolvedStyle = normalizeText(raw.style)
    || normalizeText(style)
    || 'cinematic realism'

  const audio = normalizeText(raw.audio)
    || normalizeText(scene.dialogue)
    || normalizeText(briefScene?.dialogue)

  const dialogue = normalizeText(raw.dialogue)
  const mustKeep = asStringArray(raw.mustKeep)
  const negativePrompt = normalizeText(raw.negativePrompt) || buildFallbackNegativePrompt(scene.description)

  const promptStructure: NormalizedPromptEntry['promptStructure'] = {
    subject,
    action,
    environment,
    foreground,
    midground,
    background,
    camera,
    lighting,
    motion,
    framing,
    mood,
    style: resolvedStyle,
    audio: audio || undefined,
    dialogue: dialogue || undefined,
    mustKeep: mustKeep.length ? mustKeep : undefined,
  }

  const providerPrompts = buildProviderPromptVariants(promptStructure, { hasReferenceImage })
  const canonicalPrompt = buildProfessionalPrompt(promptStructure)

  return {
    sceneIndex: raw.sceneIndex,
    prompt: resolveProviderPrompt(providerPrompts, 'happyhorse', canonicalPrompt),
    negativePrompt,
    providerPrompts,
    promptStructure,
  }
}
