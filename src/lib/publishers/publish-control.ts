/**
 * C1.4 — Contrôle opérateur
 *
 * Agrège l'état de publication en une vue lisible pour l'opérateur :
 * - état courant clair (spécifique à la plateforme si fournie),
 * - raison d'échec explicite,
 * - prochaine action évidente,
 * - healthcheck TikTok uniquement quand nécessaire (évite du trafic réseau inutile).
 */

import { readPublishResult, tiktokHealthCheck } from './tiktok'
import { readPublishManifest } from './factory'
import type { PublishControl, PublishControlState, PublishControlNextAction, PublishPlatform } from './platform-types'
import type { PublishResult } from './tiktok'
import type { PublishManifestEntry } from './platform-types'

function deriveStateFromResult(result: PublishResult | null): PublishControlState {
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

function deriveStateFromEntry(entry: PublishManifestEntry | null | undefined): PublishControlState {
  if (!entry) return 'not_published'
  switch (entry.status) {
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
 *
 * @param runId  Identifiant du run
 * @param finalDir  Répertoire final/ du run (optionnel, pour les tests)
 * @param platform  Plateforme cible (optionnel) — si fournie, l'état est dérivé
 *                  depuis publish-manifest.json pour cette plateforme spécifique
 *                  plutôt que du dernier publish-result.json global
 */
export async function getPublishControl(
  runId: string,
  finalDir?: string,
  platform?: PublishPlatform,
): Promise<PublishControl> {
  const storagePath = finalDir
    ? finalDir.replace(/\/final$/, '')
    : undefined

  // Lire publish-result.json (dernier résultat global, toutes plateformes)
  const lastResult = await readPublishResult(runId, finalDir)

  // Dériver l'état : spécifique à la plateforme si fournie, sinon global
  let baseState: PublishControlState
  if (platform) {
    const manifest = await readPublishManifest(runId, storagePath)
    const platformEntry = manifest?.platforms.find((p) => p.platform === platform)
    baseState = deriveStateFromEntry(platformEntry)
  } else {
    baseState = deriveStateFromResult(lastResult)
  }

  // Health check TikTok uniquement si on n'a pas encore de résultat ou si les credentials
  // posent problème — évite les appels réseau inutiles sur un état PROCESSING/SUCCESS/FAILED
  const needsHealthCheck = baseState === 'not_published' || baseState === 'no_credentials'
    || lastResult?.status === 'NO_CREDENTIALS'

  const tiktokHealth = needsHealthCheck
    ? await tiktokHealthCheck()
    : { status: 'ready' as const, details: 'Non vérifié (publication déjà en cours ou réussie)' }

  // Affiner l'état : si not_published mais credentials absents → no_credentials
  const state = baseState === 'not_published' && tiktokHealth.status === 'no_credentials'
    ? 'no_credentials'
    : baseState

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
