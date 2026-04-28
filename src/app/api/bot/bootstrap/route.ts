import { NextResponse } from 'next/server'
import { mkdir, stat, writeFile, copyFile } from 'fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'path'
import { createChain, getChainById, getChains } from '@/lib/db/queries/chains'
import { createRun, getRunningRun } from '@/lib/db/queries/runs'
import { listTemplates } from '@/lib/templates/loader'
import { buildIntentionPrefix } from '@/lib/intention/schema'
import { normalizeQuestionnaireAnswers, normalizeBotToken, resolveTemplateId } from '@/lib/api/bot-bootstrap'
import { getAllConfig } from '@/lib/db/queries/config'
import { parseStepLlmDefaultsFromConfigEntries } from '@/lib/settings/step-llm-defaults'
import { normalizeLlmModelForMode, normalizeLlmMode } from '@/lib/llm/target'
import { writeProjectConfig } from '@/lib/runs/project-config'
import { executePipeline } from '@/lib/pipeline/engine'
import { logger } from '@/lib/logger'

const ALLOWED_IMAGE_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
])
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const WORKSPACE_ROOT = resolve(process.cwd(), '..')
const LOCAL_IMAGE_DROP_DIR = join(WORKSPACE_ROOT, 'image-drop')

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function normalizeReferenceUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 2)
  }

  if (value && typeof value === 'object' && Array.isArray((value as { urls?: unknown[] }).urls)) {
    return normalizeReferenceUrls((value as { urls?: unknown[] }).urls)
  }

  return []
}

function normalizeLocalReferencePaths(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 2)
  }

  if (value && typeof value === 'object' && Array.isArray((value as { paths?: unknown[] }).paths)) {
    return normalizeLocalReferencePaths((value as { paths?: unknown[] }).paths)
  }

  return []
}

type InlineReferenceImageInput = {
  base64: string
  contentType: string
  fileName?: string
}

function normalizeInlineReferenceImages(value: unknown): InlineReferenceImageInput[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown[] }).items)
      ? (value as { items?: unknown[] }).items ?? []
      : []

  return items
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      base64: typeof entry.base64 === 'string' ? entry.base64.trim() : '',
      contentType: typeof entry.contentType === 'string' ? entry.contentType.trim() : '',
      fileName: typeof entry.fileName === 'string' ? entry.fileName.trim() : undefined,
    }))
    .filter((entry) => entry.base64 && entry.contentType)
    .slice(0, 2)
}

async function persistInlineReferenceImages(origin: string, items: InlineReferenceImageInput[]): Promise<string[]> {
  const urls: string[] = []

  for (const item of items) {
    if (!ALLOWED_IMAGE_TYPES.has(item.contentType)) {
      throw new Error(`Format image non supporté : ${item.contentType}`)
    }

    const buffer = Buffer.from(item.base64, 'base64')
    if (buffer.byteLength === 0) {
      throw new Error('Image inline vide')
    }
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new Error('Image inline trop lourde (max 10 MB)')
    }

    const extension = ALLOWED_IMAGE_TYPES.get(item.contentType) || '.bin'
    const fileName = `${crypto.randomUUID()}${extension}`
    const storageDir = join(process.cwd(), 'storage', 'reference-images')
    await mkdir(storageDir, { recursive: true })
    await writeFile(join(storageDir, fileName), buffer)
    urls.push(`${origin}/api/reference-images/${fileName}`)
  }

  return urls
}

function resolveLocalImagePath(inputPath: string): string {
  const resolvedPath = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(LOCAL_IMAGE_DROP_DIR, inputPath)

  const normalizedDropDir = `${LOCAL_IMAGE_DROP_DIR}${LOCAL_IMAGE_DROP_DIR.endsWith('/') ? '' : '/'}`
  if (!resolvedPath.startsWith(normalizedDropDir) && resolvedPath !== LOCAL_IMAGE_DROP_DIR) {
    throw new Error(`Chemin image hors dossier autorisé : ${inputPath}`)
  }

  return resolvedPath
}

async function persistLocalReferenceImages(origin: string, paths: string[]): Promise<string[]> {
  const urls: string[] = []
  const storageDir = join(process.cwd(), 'storage', 'reference-images')
  await mkdir(storageDir, { recursive: true })

  for (const inputPath of paths) {
    const sourcePath = resolveLocalImagePath(inputPath)
    const fileStats = await stat(sourcePath)

    if (!fileStats.isFile()) {
      throw new Error(`Image locale introuvable : ${inputPath}`)
    }

    if (fileStats.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`Image locale trop lourde (max 10 MB) : ${inputPath}`)
    }

    const extension = extname(sourcePath).toLowerCase()
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`Extension image non supportée : ${basename(sourcePath)}`)
    }

    const fileName = `${crypto.randomUUID()}${extension}`
    await copyFile(sourcePath, join(storageDir, fileName))
    urls.push(`${origin}/api/reference-images/${fileName}`)
  }

  return urls
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>
    const chainPayload = body.chain && typeof body.chain === 'object' ? body.chain as Record<string, unknown> : {}
    const runPayload = body.run && typeof body.run === 'object' ? body.run as Record<string, unknown> : {}

    const requestedChainId = asNonEmptyString(body.chainId) ?? asNonEmptyString(chainPayload.id)
    const requestedChainName = asNonEmptyString(body.chainName) ?? asNonEmptyString(chainPayload.name)
    const langSource = asNonEmptyString(body.langSource) ?? asNonEmptyString(chainPayload.langSource) ?? 'fr'
    const audience = asNonEmptyString(body.audience) ?? asNonEmptyString(chainPayload.audience) ?? undefined

    const runIdea = asNonEmptyString(body.idea) ?? asNonEmptyString(runPayload.idea)
    const runType = asNonEmptyString(body.type) ?? asNonEmptyString(runPayload.type) ?? undefined
    const requestedTemplate = asNonEmptyString(body.styleTemplate)
      ?? asNonEmptyString(body.template)
      ?? asNonEmptyString(body.style)
      ?? asNonEmptyString(runPayload.styleTemplate)
      ?? asNonEmptyString(runPayload.template)
      ?? asNonEmptyString(runPayload.style)
    const requestedMeetingMode = asNonEmptyString(body.meetingLlmMode) ?? asNonEmptyString(runPayload.meetingLlmMode)
    const requestedMeetingModel = asNonEmptyString(body.meetingLlmModel) ?? asNonEmptyString(runPayload.meetingLlmModel)
    const requestedGenerationMode = asNonEmptyString(body.generationMode) ?? asNonEmptyString(runPayload.generationMode)
    const autoStart = typeof body.autoStart === 'boolean'
      ? body.autoStart
      : typeof runPayload.autoStart === 'boolean'
        ? runPayload.autoStart
        : false

    const rawQuestionnaire = body.questionnaire ?? body.intention ?? runPayload.questionnaire ?? runPayload.intention
    const outputInput = (body.outputConfig && typeof body.outputConfig === 'object' ? body.outputConfig : null)
      ?? (runPayload.outputConfig && typeof runPayload.outputConfig === 'object' ? runPayload.outputConfig : null)
    const inlineReferenceImages = normalizeInlineReferenceImages(
      body.referenceImageFiles
      ?? body.referenceImagesInline
      ?? (body.referenceImages && typeof body.referenceImages === 'object' ? (body.referenceImages as Record<string, unknown>).items : null)
      ?? runPayload.referenceImageFiles
      ?? runPayload.referenceImagesInline
      ?? (runPayload.referenceImages && typeof runPayload.referenceImages === 'object' ? (runPayload.referenceImages as Record<string, unknown>).items : null),
    )
    const referenceUrls = normalizeReferenceUrls(
      body.referenceImageUrls
      ?? body.referenceImages
      ?? runPayload.referenceImageUrls
      ?? runPayload.referenceImages,
    )
    const localReferencePaths = normalizeLocalReferencePaths(
      body.referenceImagePaths
      ?? body.referenceImagesLocalPaths
      ?? (body.referenceImages && typeof body.referenceImages === 'object' ? (body.referenceImages as Record<string, unknown>).paths : null)
      ?? runPayload.referenceImagePaths
      ?? runPayload.referenceImagesLocalPaths
      ?? (runPayload.referenceImages && typeof runPayload.referenceImages === 'object' ? (runPayload.referenceImages as Record<string, unknown>).paths : null),
    )

    const origin = new URL(request.url).origin
    let inlineReferenceUrls: string[] = []
    let localReferenceUrls: string[] = []
    try {
      inlineReferenceUrls = await persistInlineReferenceImages(origin, inlineReferenceImages)
      localReferenceUrls = await persistLocalReferenceImages(origin, localReferencePaths)
    } catch (error) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: (error as Error).message } },
        { status: 400 },
      )
    }
    const finalReferenceUrls = [...referenceUrls, ...localReferenceUrls, ...inlineReferenceUrls].slice(0, 2)

    const invalidReferenceUrl = finalReferenceUrls.find((url) => !isValidHttpUrl(url))
    if (invalidReferenceUrl) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: `URL image invalide : ${invalidReferenceUrl}` } },
        { status: 400 },
      )
    }

    let chain = requestedChainId ? await getChainById(requestedChainId) : null
    let chainCreated = false

    if (!chain && requestedChainName) {
      const chains = await getChains()
      chain = chains.find((entry) => normalizeBotToken(entry.name) === normalizeBotToken(requestedChainName)) ?? null
    }

    if (!chain) {
      if (!requestedChainName) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'chainId ou chainName requis' } },
          { status: 400 },
        )
      }

      const chainId = crypto.randomUUID()
      chain = await createChain({ id: chainId, name: requestedChainName, langSource, audience })
      await mkdir(join(process.cwd(), 'storage', 'brands', chainId, 'images'), { recursive: true })
      chainCreated = true
    }

    if (!runIdea) {
      return NextResponse.json({
        data: {
          chain,
          chainCreated,
          urls: {
            chain: `${origin}/chains/${chain.id}`,
          },
        },
      }, { status: chainCreated ? 201 : 200 })
    }

    if (autoStart) {
      const active = await getRunningRun()
      if (active) {
        return NextResponse.json(
          { error: { code: 'RUN_ACTIVE', message: 'Un run est déjà en cours — autoStart impossible pour le moment' } },
          { status: 409 },
        )
      }
    }

    const questionnaire = normalizeQuestionnaireAnswers(rawQuestionnaire)
    if (questionnaire.errors.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Questionnaire invalide',
            details: questionnaire.errors,
          },
        },
        { status: 400 },
      )
    }

    const templates = await listTemplates()
    const templateId = requestedTemplate ? resolveTemplateId(requestedTemplate, templates) : null
    if (requestedTemplate && !templateId) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `Style/template inconnu : ${requestedTemplate}`,
            details: templates.map((template) => ({ id: template.id, name: template.name })),
          },
        },
        { status: 400 },
      )
    }

    const outputConfig = outputInput
      ? {
          videoCount: parsePositiveInt((outputInput as Record<string, unknown>).videoCount, 1),
          fullVideoDurationS: parsePositiveInt((outputInput as Record<string, unknown>).fullVideoDurationS, 60),
          sceneDurationS: parsePositiveInt((outputInput as Record<string, unknown>).sceneDurationS, 10),
          sceneCount: 1,
        }
      : null

    if (outputConfig && outputConfig.fullVideoDurationS % outputConfig.sceneDurationS !== 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'La durée de la vidéo entière doit être un multiple exact de la durée par scène.' } },
        { status: 400 },
      )
    }

    if (outputConfig) {
      outputConfig.sceneCount = Math.max(1, outputConfig.fullVideoDurationS / outputConfig.sceneDurationS)
    }

    const runId = crypto.randomUUID()
    const run = await createRun({
      id: runId,
      chainId: chain.id,
      idea: runIdea,
      template: templateId ?? undefined,
      type: runType,
    })

    const runPath = join(process.cwd(), 'storage', 'runs', runId)
    await mkdir(join(runPath, 'clips'), { recursive: true })
    await mkdir(join(runPath, 'audio'), { recursive: true })
    await mkdir(join(runPath, 'subtitles'), { recursive: true })
    await mkdir(join(runPath, 'storyboard'), { recursive: true })
    await mkdir(join(runPath, 'final'), { recursive: true })

    const configRows = await getAllConfig()
    const stepLlmDefaults = parseStepLlmDefaultsFromConfigEntries(configRows)
    const step2Default = stepLlmDefaults['2']
    const finalMeetingLlmMode = requestedMeetingMode ? normalizeLlmMode(requestedMeetingMode) : (step2Default?.mode ?? 'local')
    const finalMeetingLlmModel = normalizeLlmModelForMode(
      finalMeetingLlmMode,
      requestedMeetingModel ?? step2Default?.model,
    )

    const projectConfig = await writeProjectConfig(runPath, {
      meetingLlmMode: finalMeetingLlmMode,
      meetingLlmModel: finalMeetingLlmModel,
      stepLlmConfigs: {
        ...stepLlmDefaults,
        '2': {
          mode: finalMeetingLlmMode,
          model: finalMeetingLlmModel,
        },
      },
      outputConfig,
      referenceImages: finalReferenceUrls.length > 0 ? { urls: finalReferenceUrls } : null,
      generationMode: requestedGenerationMode === 'automatic' ? 'automatic' : 'manual',
    })

    if (Object.keys(questionnaire.answers).length > 0) {
      await writeFile(
        join(runPath, 'intention.json'),
        JSON.stringify({
          answers: questionnaire.answers,
          prefix: buildIntentionPrefix(questionnaire.answers),
          createdAt: new Date().toISOString(),
        }, null, 2),
      )
    }

    if (autoStart) {
      executePipeline(runId, { mode: 'continuous' }).catch((error) => {
        logger.error({ event: 'pipeline_crash', runId, error: (error as Error).message })
      })
    }

    return NextResponse.json({
      data: {
        chain,
        chainCreated,
        run: { ...run, projectConfig },
        normalized: {
          templateId,
          questionnaire: questionnaire.answers,
          localImageDropDir: LOCAL_IMAGE_DROP_DIR,
        },
        urls: {
          chain: `${origin}/chains/${chain.id}`,
          run: `${origin}/runs/${runId}`,
        },
      },
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}