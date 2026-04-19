import { NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { db } from '@/lib/db/connection'
import { clip } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { executeWithFailover, persistRegenerationAttempt } from '@/lib/providers/failover'
import type { ImageProvider, VideoProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'

/**
 * POST /api/runs/[id]/regenerate-scene
 * Régénère une scène ciblée (storyboard ou vidéo) sans relancer toute la chaîne.
 *
 * Body : { type: 'storyboard' | 'video', sceneIndex: number }
 *
 * Retourne :
 *   { providerUsed, failoverOccurred, failoverChain?, artefactPath, previousArtefactPath }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { type: 'storyboard' | 'video'; sceneIndex: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Corps JSON invalide' } },
      { status: 400 },
    )
  }

  const { type, sceneIndex } = body
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
    return regenerateStoryboardScene(id, sceneIndex, storagePath)
  }
  return regenerateVideoScene(id, sceneIndex, storagePath)
}

// ─── Régénération storyboard ───────────────────────────────────────────────

async function regenerateStoryboardScene(
  runId: string,
  sceneIndex: number,
  storagePath: string,
): Promise<Response> {
  // Lire le manifest storyboard pour trouver la scène et son prompt
  const manifestPath = join(storagePath, 'storyboard', 'manifest.json')
  let manifest: { images: { sceneIndex: number; description: string; filePath: string; status: string }[] }

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
  const prompt = image.description

  const storyboardDir = join(storagePath, 'storyboard')
  await mkdir(storyboardDir, { recursive: true })

  let providerUsed: string
  let failoverOccurred: boolean
  let failoverChain: { original: string; fallback: string; reason: string } | undefined
  let artefactPath: string | null = null
  let regenerationError: string | null = null

  try {
    const { result, provider, failover } = await executeWithFailover(
      'image',
      async (p) => {
        const img = p as ImageProvider
        return img.generate(
          `${prompt}. Style: cinématique, vidéo courte.`,
          { width: 768, height: 1344, style: 'cinematic', outputDir: storyboardDir },
        )
      },
      runId,
    )

    providerUsed = provider.name
    failoverOccurred = !!failover
    failoverChain = failover
      ? { original: failover.original, fallback: failover.fallback, reason: failover.reason }
      : undefined
    artefactPath = result.filePath

    // Mettre à jour le manifest storyboard
    image.filePath = result.filePath
    image.status = 'generated'
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    logger.info({
      event: 'regenerate_storyboard_success',
      runId,
      sceneIndex,
      providerUsed,
      failoverOccurred,
    })
  } catch (e) {
    const errorMsg = (e as Error).message
    providerUsed = 'none'
    failoverOccurred = false
    regenerationError = errorMsg
    logger.warn({ event: 'regenerate_storyboard_failed', runId, sceneIndex, error: errorMsg })
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
    },
  })
}

// ─── Régénération clip vidéo ───────────────────────────────────────────────

async function regenerateVideoScene(
  runId: string,
  sceneIndex: number,
  storagePath: string,
): Promise<Response> {
  // Lire prompts.json pour récupérer le prompt de la scène
  let promptData: { prompts: { sceneIndex: number; prompt: string }[] }
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
        return video.generate(entry.prompt, {
          resolution: '720p',
          duration: 10,
          aspectRatio: '9:16',
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
    const errorMsg = (e as Error).message
    providerUsed = 'none'
    failoverOccurred = false
    regenerationError = errorMsg
    logger.warn({ event: 'regenerate_video_failed', runId, sceneIndex, error: errorMsg })

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
