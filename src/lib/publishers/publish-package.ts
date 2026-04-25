/**
 * C1.1 — Paquet de publication propre
 *
 * Produit et lit publish-package.json, artefact canonique qui établit
 * la chaîne de traçabilité audio → preview → publication.
 *
 * Persisté dans : storage/runs/{runId}/final/publish-package.json
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { PublishPackage } from './platform-types'

function resolveFinalDir(runId: string, finalDir?: string): string {
  return finalDir ?? join(process.cwd(), 'storage', 'runs', runId, 'final')
}

/**
 * Construit un PublishPackage à partir des manifests disponibles.
 */
export function buildPublishPackage(opts: {
  runId: string
  audio: {
    masterPath: string
    totalDurationS: number
    sceneCount: number
    generatedAt: string
  }
  preview: {
    mode: 'video_finale' | 'animatic' | 'storyboard_only' | 'none'
    playableFilePath: string | null
    hasAudio: boolean
  }
  publication: {
    title: string
    description: string
    hashtags: string[]
  }
}): PublishPackage {
  return {
    runId: opts.runId,
    version: 1,
    audio: opts.audio,
    preview: opts.preview,
    publication: {
      ...opts.publication,
      platforms: {
        tiktok: { format: '9:16', maxDuration: 180 },
        youtube_shorts: { format: '9:16', maxDuration: 60 },
        instagram_reels: { format: '9:16', maxDuration: 90 },
      },
    },
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Persiste le publish-package dans final/publish-package.json.
 */
export async function savePublishPackage(
  runId: string,
  pkg: PublishPackage,
  finalDir?: string,
): Promise<void> {
  const resolvedFinalDir = resolveFinalDir(runId, finalDir)
  await mkdir(resolvedFinalDir, { recursive: true })
  await writeFile(join(resolvedFinalDir, 'publish-package.json'), JSON.stringify(pkg, null, 2))
}

/**
 * Lit le publish-package existant, ou null s'il est absent.
 */
export async function readPublishPackage(
  runId: string,
  finalDir?: string,
): Promise<PublishPackage | null> {
  try {
    const raw = await readFile(
      join(resolveFinalDir(runId, finalDir), 'publish-package.json'),
      'utf-8',
    )
    return JSON.parse(raw) as PublishPackage
  } catch {
    return null
  }
}
