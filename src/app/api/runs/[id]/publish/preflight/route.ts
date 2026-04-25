import { NextResponse } from 'next/server'
import { runPublishPreflight } from '@/lib/publishers/preflight'
import { isSupportedPlatform, SUPPORTED_PUBLISH_PLATFORMS } from '@/lib/publishers/factory'
import { logger } from '@/lib/logger'
import { join } from 'path'

/**
 * GET /api/runs/[id]/publish/preflight?platform=tiktok
 *
 * C1.2 — Dry-run opérable : vérifie tous les prérequis avant publication.
 * Aucun effet de bord — lecture seule.
 *
 * Retourne un PreflightReport :
 *   - ready: boolean
 *   - checks: vérifications détaillées (manifest, vidéo, credentials, metadata)
 *   - nextAction: action recommandée
 *   - nextActionLabel: libellé lisible
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const url = new URL(request.url)
    const platform = url.searchParams.get('platform') ?? 'tiktok'

    if (!isSupportedPlatform(platform)) {
      return NextResponse.json(
        {
          error: {
            code: 'UNSUPPORTED_PLATFORM',
            message: `Plateforme "${platform}" non supportée. Plateformes disponibles : ${SUPPORTED_PUBLISH_PLATFORMS.join(', ')}`,
          },
        },
        { status: 400 },
      )
    }

    logger.info({ event: 'publish_preflight_start', runId: id, platform })
    const report = await runPublishPreflight(id, platform, join(process.cwd(), 'storage', 'runs', id))
    logger.info({ event: 'publish_preflight_done', runId: id, platform, ready: report.ready, nextAction: report.nextAction })
    return NextResponse.json({ data: report }, { status: report.ready ? 200 : 422 })
  } catch (e) {
    logger.error({ event: 'publish_preflight_error', error: (e as Error).message })
    return NextResponse.json(
      { error: { code: 'PREFLIGHT_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
