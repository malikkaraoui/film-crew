import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { savePublishResult, readPublishResult } from '@/lib/publishers/tiktok'
import { publishToPlatform, isSupportedPlatform, upsertPublishManifest } from '@/lib/publishers/factory'
import { readPublishPackage } from '@/lib/publishers/publish-package'
import { logger } from '@/lib/logger'

/**
 * POST /api/runs/[id]/publish/retry
 *
 * C1.3 — Relance propre : retente la publication sans réinitialiser les artefacts.
 *
 * Lit le publish-package.json (C1.1) comme source de vérité pour
 * le chemin vidéo, le titre et les hashtags.
 * Fallback sur preview-manifest.json + metadata.json si le paquet est absent.
 *
 * Incrémente retryCount à chaque relance pour la traçabilité.
 *
 * Body : { platform?: 'tiktok' | 'youtube_shorts' }  (optionnel, défaut: tiktok)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { platform?: string } = {}
  try {
    body = await request.json()
  } catch { /* body optionnel */ }

  const platform = body.platform ?? 'tiktok'
  if (!isSupportedPlatform(platform)) {
    return NextResponse.json(
      { error: { code: 'UNSUPPORTED_PLATFORM', message: `Plateforme "${platform}" non supportée` } },
      { status: 400 },
    )
  }

  const storagePath = join(process.cwd(), 'storage', 'runs', id)

  // Résoudre videoPath, title, hashtags, mediaMode depuis publish-package (C1.1) ou fallback
  let videoPath: string
  let title: string
  let hashtags: string[]
  let mediaMode: string

  const pkg = await readPublishPackage(id, join(storagePath, 'final'))

  if (pkg) {
    const playable = pkg.preview.playableFilePath
    videoPath = playable
      ? (isAbsolute(playable) ? playable : join(process.cwd(), playable.replace(/^\//, '')))
      : join(storagePath, 'final', pkg.preview.mode === 'video_finale' ? 'video.mp4' : 'animatic.mp4')
    title = pkg.publication.title
    hashtags = pkg.publication.hashtags
    mediaMode = pkg.preview.mode
  } else {
    // Fallback : preview-manifest + metadata
    let previewManifest: { mode: string; playableFilePath: string | null } = { mode: 'none', playableFilePath: null }
    try {
      previewManifest = JSON.parse(await readFile(join(storagePath, 'preview-manifest.json'), 'utf-8'))
    } catch {
      return NextResponse.json(
        { error: { code: 'NO_MEDIA', message: 'Aucun paquet de publication — lancer le pipeline (step 9) avant de relancer' } },
        { status: 422 },
      )
    }

    const { playableFilePath, mode } = previewManifest
    videoPath = playableFilePath
      ? (isAbsolute(playableFilePath) ? playableFilePath : join(process.cwd(), playableFilePath.replace(/^\//, '')))
      : join(storagePath, 'final', mode === 'video_finale' ? 'video.mp4' : 'animatic.mp4')
    mediaMode = mode

    let metaFile: { title?: string; hashtags?: string[] } = {}
    try {
      metaFile = JSON.parse(await readFile(join(storagePath, 'final', 'metadata.json'), 'utf-8'))
    } catch { /* optionnel */ }

    title = metaFile.title ?? `FILM CREW — ${id}`
    hashtags = Array.isArray(metaFile.hashtags) && metaFile.hashtags.length > 0
      ? metaFile.hashtags
      : ['#shorts', '#ai', '#filmcrew']
  }

  // Récupérer le retryCount précédent pour l'incrémenter (spécifique à la plateforme)
  const previous = await readPublishResult(id, join(storagePath, 'final'))
  const previousRetryCount = previous?.platform === platform ? (previous.retryCount ?? 0) : 0
  const retryCount = previousRetryCount + 1

  logger.info({ event: 'publish_retry_start', runId: id, platform, retryCount, fromPackage: !!pkg })

  const result = await publishToPlatform(platform, { runId: id, videoPath, title, hashtags, mediaMode })
  const resultWithRetry = { ...result, retryCount }

  await savePublishResult(id, resultWithRetry, join(storagePath, 'final'))
  await upsertPublishManifest(id, result, { title, hashtags }, storagePath)

  logger.info({
    event: 'publish_retry_complete',
    runId: id,
    platform,
    status: result.status,
    retryCount,
  })

  const httpStatus = result.status === 'SUCCESS' || result.status === 'PROCESSING'
    ? 200
    : result.status === 'NO_CREDENTIALS'
    ? 403
    : result.status === 'NO_MEDIA'
    ? 422
    : 502

  return NextResponse.json({ data: resultWithRetry }, { status: httpStatus })
}
