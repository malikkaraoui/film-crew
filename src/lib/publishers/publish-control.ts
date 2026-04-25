/**
 * C1.4 — Contrôle opérateur
 *
 * Agrège l'état de publication en une vue lisible pour l'opérateur :
 * - état courant clair,
 * - raison d'échec explicite,
 * - prochaine action évidente.
 */

import { readPublishResult, tiktokHealthCheck } from './tiktok'
import type { PublishControl, PublishControlState, PublishControlNextAction } from './platform-types'
import type { PublishResult } from './tiktok'

function deriveState(result: PublishResult | null): PublishControlState {
  if (!result) return 'not_published'
  switch (result.status) {
    case 'SUCCESS': return 'published'
    case 'PROCESSING': return 'processing'
    case 'FAILED': return 'failed'
    case 'NO_MEDIA': return 'no_media'
    case 'NO_CREDENTIALS': return 'no_credentials'
    default: return 'not_published'
  }
}

function deriveNextAction(state: PublishControlState): {
  action: PublishControlNextAction
  label: string
} {
  switch (state) {
    case 'not_published':
      return { action: 'publish', label: 'POST /api/runs/{id}/publish { "platform": "tiktok" }' }
    case 'published':
      return { action: 'none', label: 'Publication réussie — rien à faire' }
    case 'processing':
      return { action: 'manual_check', label: 'Vérifier manuellement sur TikTok avec le publishId fourni dans lastResult' }
    case 'failed':
      return { action: 'retry', label: 'POST /api/runs/{id}/publish/retry pour relancer sans recréer la vidéo' }
    case 'no_media':
      return { action: 'run_pipeline', label: "Lancer le pipeline jusqu'à l'étape Preview (step 9) pour générer le fichier vidéo" }
    case 'no_credentials':
      return { action: 'fix_credentials', label: 'Configurer TIKTOK_ACCESS_TOKEN dans .env.local puis redémarrer' }
  }
}

/**
 * Retourne l'état de publication consolidé pour l'opérateur.
 * Aucun effet de bord — lecture seule.
 */
export async function getPublishControl(runId: string, finalDir?: string): Promise<PublishControl> {
  const [lastResult, tiktokHealth] = await Promise.all([
    readPublishResult(runId, finalDir),
    tiktokHealthCheck(),
  ])

  const state = deriveState(lastResult)
  const { action, label } = deriveNextAction(state)

  return {
    runId,
    state,
    lastResult,
    platformHealth: { tiktok: tiktokHealth },
    nextAction: action,
    nextActionLabel: label,
    ...(lastResult?.error !== undefined && { failureReason: lastResult.error }),
    ...(lastResult?.publishedAt !== undefined && { publishedAt: lastResult.publishedAt }),
    generatedAt: new Date().toISOString(),
  }
}
