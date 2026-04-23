import { NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { db } from '@/lib/db/connection'
import { clip } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { executeWithFailover, persistRegenerationAttempt, FailoverError } from '@/lib/providers/failover'
import {
  storyboardLocalProvider,
  buildLocalStoryboardPrompt,
  composeStoryboardBoard,
  mergeStoryboardPromptWithCloudPlan,
} from '@/lib/providers/image/storyboard-local'
import { queueStoryboardCloudPlanGeneration } from '@/lib/storyboard/cloud-plan'
import type { VideoProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'
import { getBlueprintScene, readStoryboardBlueprint } from '@/lib/storyboard/blueprint'
import { readProjectConfig } from '@/lib/runs/project-config'

/**
 * POST /api/runs/[id]/regenerate-scene
 * Régénère une scène ciblée (storyboard ou vidéo) sans relancer toute la chaîne.
 *
 * Body : { type: 'storyboard' | 'video', sceneIndex: number, prompt?: string, negativePrompt?: string }
 *
 * Retourne :
 *   { providerUsed, failoverOccurred, failoverChain?, artefactPath, previousArtefactPath }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { type: 'storyboard' | 'video'; sceneIndex: number; prompt?: string; negativePrompt?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Corps JSON invalide' } },
      { status: 400 },
    )
  }

  const { type, sceneIndex, prompt, negativePrompt } = body
  if (!type || typeof sceneIndex !== 'number') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'type et sceneIndex requis' } },
      { status: 400 },
    )
  }
  if (type !== 'storyboard' && type !== 'video') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'type doit être "storyboard" ou "video"' } },
      { status: 400 },
    )
  }

  const storagePath = join(process.cwd(), 'storage', 'runs', id)

  logger.info({ event: 'regenerate_scene_start', runId: id, type, sceneIndex })

  if (type === 'storyboard') {
    return regenerateStoryboardScene(id, sceneIndex, storagePath, prompt)
  }
  return regenerateVideoScene(id, sceneIndex, storagePath, prompt, negativePrompt)
}

// ─── Régénération storyboard ───────────────────────────────────────────────

async function regenerateStoryboardScene(
  runId: string,
  sceneIndex: number,
  storagePath: string,
  customPrompt?: string,
): Promise<Response> {
  // Lire le manifest storyboard pour trouver la scène et son prompt
  const manifestPath = join(storagePath, 'storyboard', 'manifest.json')
  let manifest: {
    images: { sceneIndex: number; description: string; prompt?: string; filePath: string; status: string; providerUsed?: string | null; failoverOccurred?: boolean; isPlaceholder?: boolean; cloudPlanStatus?: 'queued' | 'ready' | 'failed' | null; cloudPlanModel?: string | null; cloudPlanMode?: string | null; cloudPlanFilePath?: string | null; cloudPlanRequestedAt?: string | null; cloudPlanCompletedAt?: string | null; cloudPlanError?: string | null }[]
    boardFilePath?: string | null
    boardLayout?: string | null
  }

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
  } catch {
    return NextResponse.json(
      { error: { code: 'NO_MANIFEST', message: 'storyboard/manifest.json introuvable' } },
      { status: 404 },
    )
  }

  const image = manifest.images.find((i) => i.sceneIndex === sceneIndex)
  if (!image) {
    return NextResponse.json(
      { error: { code: 'SCENE_NOT_FOUND', message: `Scène ${sceneIndex} absente du manifest storyboard` } },
      { status: 404 },
    )
  }

  const previousArtefactPath = image.filePath
  let structureScene: {
    index: number
    description: string
    lighting: string
    camera: string
    duration_s?: number
    dialogue?: string
  } | null = null
  try {
    const structure = JSON.parse(await readFile(join(storagePath, 'structure.json'), 'utf-8')) as {
      scenes?: Array<{
        index: number
        description: string
        lighting: string
        camera: string
        duration_s?: number
        dialogue?: string
      }>
    }
    structureScene = structure.scenes?.find((scene) => scene.index === sceneIndex) ?? null
  } catch {
    structureScene = null
  }

  const blueprint = await readStoryboardBlueprint(storagePath)
  const blueprintScene = getBlueprintScene(blueprint, sceneIndex)

  const rawPrompt = customPrompt?.trim() || image.prompt || image.description
  const basePrompt = /(^|\n)(Scene|Description|Lighting|Camera):/i.test(rawPrompt)
    ? rawPrompt
    : buildLocalStoryboardPrompt({
        sceneIndex,
        description: customPrompt?.trim() || structureScene?.description || image.description,
        lighting: structureScene?.lighting || 'Natural light',
        camera: structureScene?.camera || 'Static camera',
        durationS: structureScene?.duration_s,
        dialogue: structureScene?.dialogue,
      })
  const prompt = blueprintScene
    ? mergeStoryboardPromptWithCloudPlan(basePrompt, blueprintScene)
    : basePrompt
  image.prompt = prompt
  if (blueprintScene?.childCaption) {
    image.description = blueprintScene.childCaption
  }

  const storyboardDir = join(storagePath, 'storyboard')
  await mkdir(storyboardDir, { recursive: true })

  let providerUsed: string
  let failoverOccurred: boolean
  let failoverChain: { original: string; fallback: string; reason: string } | undefined
  let artefactPath: string | null = null
  let regenerationError: string | null = null
  let cloudPlanJob: { queued: boolean; sceneCount: number; model?: string; mode?: string } = { queued: false, sceneCount: 0 }

  try {
    const result = await storyboardLocalProvider.generate(
      prompt,
      { width: 1280, height: 720, style: 'storyboard-rough-local', outputDir: storyboardDir },
    )

    providerUsed = storyboardLocalProvider.name
    failoverOccurred = false
    failoverChain = undefined
    artefactPath = result.filePath

    const isPlaceholder = false

    // Mettre à jour le manifest storyboard
    image.filePath = result.filePath
    image.status = isPlaceholder ? 'pending' : 'generated'
    image.providerUsed = storyboardLocalProvider.name
    image.failoverOccurred = false
    image.isPlaceholder = isPlaceholder

    const board = await composeStoryboardBoard(manifest.images, storyboardDir)
    manifest.boardFilePath = board.filePath
    manifest.boardLayout = `${board.columns}x${board.rows}`
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    cloudPlanJob = await queueStoryboardCloudPlanGeneration({
      runId,
      storagePath,
      sceneIndex,
      description: structureScene?.description || image.description,
      prompt,
      camera: structureScene?.camera,
      lighting: blueprintScene?.lighting || structureScene?.lighting,
      durationS: structureScene?.duration_s,
      blueprint: blueprintScene,
    })

    logger.info({
      event: 'regenerate_storyboard_success',
      runId,
      sceneIndex,
      providerUsed,
      failoverOccurred,
    })
  } catch (e) {
    if (e instanceof FailoverError) {
      providerUsed = e.providerUsed
      failoverOccurred = e.failoverOccurred
      failoverChain = e.failoverChain
      regenerationError = e.message
    } else {
      providerUsed = 'none'
      failoverOccurred = false
      regenerationError = (e as Error).message
    }
    logger.warn({ event: 'regenerate_storyboard_failed', runId, sceneIndex, error: regenerationError, providerUsed, failoverOccurred })
  }

  // Persister la tentative dans failover-log.json (toujours, succès ou échec)
  await persistRegenerationAttempt(runId, {
    type: 'storyboard',
    sceneIndex,
    providerUsed,
    failoverOccurred,
    failoverChain,
    success: !regenerationError,
    artefactPath,
    error: regenerationError ?? undefined,
    timestamp: new Date().toISOString(),
  })

  if (regenerationError) {
    return NextResponse.json(
      {
        error: {
          code: 'REGENERATION_FAILED',
          message: regenerationError,
          providerUsed,
          failoverOccurred,
        },
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    data: {
      type: 'storyboard',
      sceneIndex,
      providerUsed,
      failoverOccurred,
      failoverChain,
      artefactPath,
      previousArtefactPath,
      cloudPlanQueued: cloudPlanJob.queued,
      cloudPlanModel: cloudPlanJob.model ?? null,
      cloudPlanMode: cloudPlanJob.mode ?? null,
    },
  })
}

// ─── Régénération clip vidéo ───────────────────────────────────────────────

async function regenerateVideoScene(
  runId: string,
  sceneIndex: number,
  storagePath: string,
  customPrompt?: string,
  customNegativePrompt?: string,
): Promise<Response> {
  const projectConfig = await readProjectConfig(storagePath)
  const referenceImageUrls = projectConfig?.referenceImages?.urls ?? []

  // Lire prompts.json pour récupérer le prompt de la scène
  let promptData: { prompts: { sceneIndex: number; prompt: string; negativePrompt?: string }[] }
  try {
    promptData = JSON.parse(await readFile(join(storagePath, 'prompts.json'), 'utf-8'))
  } catch {
    return NextResponse.json(
      { error: { code: 'NO_PROMPTS', message: 'prompts.json introuvable' } },
      { status: 404 },
    )
  }

  const entry = promptData.prompts.find((p) => p.sceneIndex === sceneIndex)
  if (!entry) {
    return NextResponse.json(
      { error: { code: 'SCENE_NOT_FOUND', message: `Scène ${sceneIndex} absente des prompts` } },
      { status: 404 },
    )
  }

  if (customPrompt?.trim()) {
    entry.prompt = customPrompt.trim()
  }
  if (customNegativePrompt !== undefined) {
    entry.negativePrompt = customNegativePrompt
  }
  await writeFile(join(storagePath, 'prompts.json'), JSON.stringify(promptData, null, 2))

  try {
    const promptManifestPath = join(storagePath, 'prompt-manifest.json')
    const promptManifest = JSON.parse(await readFile(promptManifestPath, 'utf-8')) as {
      prompts?: Array<{ sceneIndex: number; prompt: string; negativePrompt?: string }>
    }
    const manifestEntry = promptManifest.prompts?.find((p) => p.sceneIndex === sceneIndex)
    if (manifestEntry) {
      manifestEntry.prompt = entry.prompt
      if (customNegativePrompt !== undefined) {
        manifestEntry.negativePrompt = customNegativePrompt
      }
      await writeFile(promptManifestPath, JSON.stringify(promptManifest, null, 2))
    }
  } catch {
    // non bloquant
  }

  // Trouver le clip précédent en DB pour tracer "avant/après"
  const existingClips = await db
    .select()
    .from(clip)
    .where(and(eq(clip.runId, runId), eq(clip.stepIndex, sceneIndex)))
  const previousClip = existingClips[existingClips.length - 1] ?? null

  const clipsDir = join(storagePath, 'clips')
  await mkdir(clipsDir, { recursive: true })

  let providerUsed: string
  let failoverOccurred: boolean
  let failoverChain: { original: string; fallback: string; reason: string } | undefined
  let artefactPath: string | null = null
  let regenerationError: string | null = null

  try {
    const { result, provider, failover } = await executeWithFailover(
      'video',
      async (p) => {
        const video = p as VideoProvider
        if (video.name === 'sketch-local') {
          throw new Error('sketch-local est désactivé pour le pipeline standard : brouillon texte local non acceptable comme clip final')
        }
        return video.generate(entry.prompt, {
          resolution: '720p',
          duration: 10,
          aspectRatio: '9:16',
          referenceImageUrls,
          outputDir: clipsDir,
        })
      },
      runId,
    )

    providerUsed = provider.name
    failoverOccurred = !!failover
    failoverChain = failover
      ? { original: failover.original, fallback: failover.fallback, reason: failover.reason }
      : undefined
    artefactPath = result.filePath

    // Insérer un nouveau clip en DB (on garde l'historique)
    await db.insert(clip).values({
      id: crypto.randomUUID(),
      runId,
      stepIndex: sceneIndex,
      prompt: entry.prompt,
      provider: provider.name,
      status: 'completed',
      filePath: result.filePath,
      seed: result.seed,
      costEur: result.costEur,
    })

    // Mettre à jour generation-manifest.json
    try {
      const manifestPath = join(storagePath, 'generation-manifest.json')
      const genManifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      const existing = genManifest.clips.findIndex(
        (c: { sceneIndex: number }) => c.sceneIndex === sceneIndex,
      )
      const updatedClip = {
        sceneIndex,
        filePath: result.filePath,
        seed: result.seed,
        costEur: result.costEur,
        providerUsed: provider.name,
        failoverOccurred: !!failover,
        ...(failover ? { failoverChain: { original: failover.original, fallback: failover.fallback, reason: failover.reason } } : {}),
        regeneratedAt: new Date().toISOString(),
      }
      if (existing >= 0) {
        genManifest.clips[existing] = updatedClip
      } else {
        genManifest.clips.push(updatedClip)
      }
      await writeFile(manifestPath, JSON.stringify(genManifest, null, 2))
    } catch { /* non bloquant */ }

    logger.info({
      event: 'regenerate_video_success',
      runId,
      sceneIndex,
      providerUsed,
      failoverOccurred,
    })
  } catch (e) {
    if (e instanceof FailoverError) {
      providerUsed = e.providerUsed
      failoverOccurred = e.failoverOccurred
      failoverChain = e.failoverChain
      regenerationError = e.message
    } else {
      providerUsed = 'none'
      failoverOccurred = false
      regenerationError = (e as Error).message
    }
    logger.warn({ event: 'regenerate_video_failed', runId, sceneIndex, error: regenerationError, providerUsed, failoverOccurred })

    // Marquer le clip comme failed en DB
    await db.insert(clip).values({
      id: crypto.randomUUID(),
      runId,
      stepIndex: sceneIndex,
      prompt: entry.prompt,
      provider: 'none',
      status: 'failed',
      retries: (previousClip?.retries ?? 0) + 1,
    }).catch(() => {})
  }

  // Persister la tentative (succès ou échec)
  await persistRegenerationAttempt(runId, {
    type: 'video',
    sceneIndex,
    providerUsed,
    failoverOccurred,
    failoverChain,
    success: !regenerationError,
    artefactPath,
    error: regenerationError ?? undefined,
    timestamp: new Date().toISOString(),
  })

  if (regenerationError) {
    return NextResponse.json(
      {
        error: {
          code: 'REGENERATION_FAILED',
          message: regenerationError,
          providerUsed,
          failoverOccurred,
        },
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    data: {
      type: 'video',
      sceneIndex,
      providerUsed,
      failoverOccurred,
      failoverChain,
      artefactPath,
      previousArtefactPath: previousClip?.filePath ?? null,
    },
  })
}
