import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { savePublishResult } from '@/lib/publishers/tiktok'
import { publishToPlatform, isSupportedPlatform, upsertPublishManifest, SUPPORTED_PUBLISH_PLATFORMS } from '@/lib/publishers/factory'
import { runPublishPreflight } from '@/lib/publishers/preflight'
import { getPublishControl } from '@/lib/publishers/publish-control'
import { logger } from '@/lib/logger'

type PreviewManifest = {
  mode: 'video_finale' | 'animatic' | 'storyboard_only' | 'none'
  playableFilePath: string | null
  mediaType: string | null
  hasAudio: boolean
}

/**
 * GET /api/runs/[id]/publish
 *
 * C1.4 — Contrôle opérateur enrichi.
 * Retourne un PublishControl : état, dernier résultat, santé plateforme, prochaine action.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const control = await getPublishControl(id, join(process.cwd(), 'storage', 'runs', id, 'final'))
    logger.info({ event: 'publish_control_fetched', runId: id, state: control.state, nextAction: control.nextAction })
    return NextResponse.json({ data: control })
  } catch (e) {
    logger.error({ event: 'publish_control_error', error: (e as Error).message })
    return NextResponse.json(
      { error: { code: 'PUBLISH_STATUS_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}

/**
 * POST /api/runs/[id]/publish
 * Déclenche la publication sur la plateforme demandée.
 *
 * Body : { platform: 'tiktok' | 'youtube_shorts' }
 *
 * Retourne toujours un PublishResult honnête :
 *   - NO_CREDENTIALS si le token plateforme est absent
 *   - NO_MEDIA si aucun fichier vidéo disponible
 *   - SUCCESS / PROCESSING / FAILED selon le résultat réel
 *
 * Le résultat est persisté dans :
 *   - storage/runs/{id}/final/publish-result.json  (dernière publication)
 *   - storage/runs/{id}/publish-manifest.json       (historique multi-plateforme, upsert)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { platform: string; dry_run?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Corps JSON invalide' } },
      { status: 400 },
    )
  }

  // C1.2 — Mode dry_run : retourne le rapport preflight sans publier
  if (body.dry_run) {
    const platform = isSupportedPlatform(body.platform) ? body.platform : 'tiktok'
    logger.info({ event: 'publish_dry_run', runId: id, platform })
    const report = await runPublishPreflight(id, platform, join(process.cwd(), 'storage', 'runs', id))
    return NextResponse.json({ data: report }, { status: report.ready ? 200 : 422 })
  }

  if (!isSupportedPlatform(body.platform)) {
    return NextResponse.json(
      {
        error: {
          code: 'UNSUPPORTED_PLATFORM',
          message: `Plateforme "${body.platform}" non supportée. Plateformes disponibles : ${SUPPORTED_PUBLISH_PLATFORMS.join(', ')}`,
        },
      },
      { status: 400 },
    )
  }

  const storagePath = join(process.cwd(), 'storage', 'runs', id)

  logger.info({ event: 'publish_start', runId: id, platform: body.platform })

  // Lire le preview-manifest pour obtenir le fichier vidéo
  let previewManifest: PreviewManifest
  try {
    const raw = await readFile(join(storagePath, 'preview-manifest.json'), 'utf-8')
    previewManifest = JSON.parse(raw)
  } catch {
    const result = {
      platform: body.platform as 'tiktok' | 'youtube_shorts',
      status: 'NO_MEDIA' as const,
      error: 'preview-manifest.json introuvable — le pipeline doit atteindre le step 8 (Preview) avant publication',
      credentials: {
        hasAccessToken: false,
        hasClientKey: false,
      },
      runId: id,
      title: '',
      hashtags: [],
      mediaMode: 'none',
    }
    await savePublishResult(id, result, join(storagePath, 'final'))
    return NextResponse.json({ data: result }, { status: 422 })
  }

  const { playableFilePath, mode } = previewManifest

  // Lire les métadonnées (titre, hashtags) depuis final/metadata.json
  let title = `FILM CREW — ${id}`
  let hashtags = ['#shorts', '#ai', '#filmcrew']
  try {
    const meta = JSON.parse(await readFile(join(storagePath, 'final', 'metadata.json'), 'utf-8'))
    if (meta.title) title = meta.title
    if (Array.isArray(meta.hashtags) && meta.hashtags.length > 0) hashtags = meta.hashtags
  } catch { /* metadata optionnelle */ }

  // Construire le chemin absolu du fichier vidéo
  const videoPath = playableFilePath
    ? (isAbsolute(playableFilePath)
      ? playableFilePath
      : join(process.cwd(), playableFilePath.replace(/^\//, '')))
    : join(storagePath, 'final', mode === 'video_finale' ? 'video.mp4' : 'animatic.mp4')

  // Publier via le factory
  const result = await publishToPlatform(body.platform, {
    runId: id,
    videoPath,
    title,
    hashtags,
    mediaMode: mode,
  })

  // Persister : publish-result.json (dernière pub) + publish-manifest.json (historique)
  await savePublishResult(id, result, join(storagePath, 'final'))
  await upsertPublishManifest(id, result, { title, hashtags }, storagePath)

  logger.info({
    event: 'publish_complete',
    runId: id,
    platform: body.platform,
    status: result.status,
    publishId: result.publishId,
  })

  const httpStatus = result.status === 'SUCCESS' || result.status === 'PROCESSING'
    ? 200
    : result.status === 'NO_CREDENTIALS'
    ? 403
    : result.status === 'NO_MEDIA'
    ? 422
    : 502

  return NextResponse.json({ data: result }, { status: httpStatus })
}
