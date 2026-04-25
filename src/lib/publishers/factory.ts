import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { logger } from '@/lib/logger'
import type { PublishResult } from '@/lib/publishers/tiktok'
import type { PublishPlatform, PublishManifest, PublishManifestEntry } from '@/lib/publishers/platform-types'
import { publishToTikTok } from '@/lib/publishers/tiktok'
import { publishToYouTubeShorts } from '@/lib/publishers/youtube'

/**
 * Publisher factory — Lot 11B
 *
 * Point d'entrée unique pour toute publication multi-plateforme.
 * Ajouter une nouvelle plateforme : implémenter le publisher, l'ajouter ici.
 */

export const SUPPORTED_PUBLISH_PLATFORMS: PublishPlatform[] = ['tiktok', 'youtube_shorts']

/**
 * Guard : vérifie si une chaîne est une plateforme supportée.
 */
export function isSupportedPlatform(platform: string): platform is PublishPlatform {
  return (SUPPORTED_PUBLISH_PLATFORMS as string[]).includes(platform)
}

/**
 * Délègue la publication à la plateforme demandée.
 * Lève une erreur si la plateforme n'est pas supportée.
 */
export async function publishToPlatform(
  platform: string,
  opts: {
    runId: string
    videoPath: string
    title: string
    hashtags: string[]
    mediaMode: string
  },
): Promise<PublishResult> {
  switch (platform) {
    case 'tiktok':
      return publishToTikTok(opts)
    case 'youtube_shorts':
      return publishToYouTubeShorts(opts)
    default:
      throw new Error(
        `Plateforme "${platform}" non supportée. Plateformes disponibles : ${SUPPORTED_PUBLISH_PLATFORMS.join(', ')}`,
      )
  }
}

/**
 * Persiste le résultat d'une publication dans publish-manifest.json (upsert par plateforme).
 *
 * Additivité : si la plateforme a déjà une entrée, elle est remplacée.
 * Les autres entrées sont conservées.
 * Analogie : même pattern que localize-manifest.json en 11A.
 */
export async function upsertPublishManifest(
  runId: string,
  result: PublishResult,
  opts: { title: string; hashtags: string[] },
  storagePath?: string,
): Promise<PublishManifest> {
  const runDir = storagePath ?? join(process.cwd(), 'storage', 'runs', runId)
  const manifestPath = join(runDir, 'publish-manifest.json')

  let existing: PublishManifest | null = null
  try {
    existing = JSON.parse(await readFile(manifestPath, 'utf-8'))
  } catch { /* premier appel — pas encore de manifest */ }

  const entry: PublishManifestEntry = {
    platform: result.platform as PublishPlatform,
    status: result.status,
    ...(result.publishId !== undefined && { publishId: result.publishId }),
    ...(result.videoId !== undefined && { videoId: result.videoId }),
    ...(result.shareUrl !== undefined && { shareUrl: result.shareUrl }),
    ...(result.profileUrl !== undefined && { profileUrl: result.profileUrl }),
    ...(result.error !== undefined && { error: result.error }),
    ...(result.instructions !== undefined && { instructions: result.instructions }),
    ...(result.publishedAt !== undefined && { publishedAt: result.publishedAt }),
    ...(result.mediaSizeBytes !== undefined && { mediaSizeBytes: result.mediaSizeBytes }),
  }

  const previousPlatforms = existing?.platforms.filter((p) => p.platform !== result.platform) ?? []

  const manifest: PublishManifest = {
    runId,
    version: 1,
    title: opts.title,
    hashtags: opts.hashtags,
    platforms: [...previousPlatforms, entry],
    generatedAt: new Date().toISOString(),
  }

  await mkdir(runDir, { recursive: true })
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

  logger.info({
    event: 'publish_manifest_written',
    runId,
    platform: result.platform,
    status: result.status,
    totalPlatforms: manifest.platforms.length,
  })

  return manifest
}
