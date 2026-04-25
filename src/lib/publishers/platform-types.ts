/**
 * Types partagés — publication multi-plateforme (Lot 11B + C1)
 *
 * Source unique pour PublishPlatform, PublishStatus et les types de manifest.
 * Chaque publisher importe ces types plutôt que de les dupliquer.
 */

/** Plateformes supportées par le publisher factory */
export type PublishPlatform = 'tiktok' | 'youtube_shorts'

/** Statuts de publication possibles */
export type PublishStatus =
  | 'SUCCESS'
  | 'PROCESSING'
  | 'FAILED'
  | 'NO_CREDENTIALS'
  | 'NO_MEDIA'

/**
 * Entrée traçable du publish-manifest.json par plateforme.
 * Chaque plateforme a sa propre entrée dans le manifest.
 */
export type PublishManifestEntry = {
  platform: PublishPlatform
  status: PublishStatus
  publishId?: string
  videoId?: string
  shareUrl?: string
  profileUrl?: string
  error?: string
  instructions?: string
  publishedAt?: string
  mediaSizeBytes?: number
}

/**
 * Manifest traçable de toutes les publications d'un run.
 * Persisté dans storage/runs/{runId}/publish-manifest.json.
 * Additivité : chaque appel à POST /publish met à jour l'entrée pour la plateforme concernée,
 * sans écraser les autres.
 */
export type PublishManifest = {
  runId: string
  version: 1
  title: string
  hashtags: string[]
  platforms: PublishManifestEntry[]
  generatedAt: string
}

// ─── C1.1 — Paquet de publication propre ───────────────────────────────────

/**
 * Paquet canonique de publication — lien explicite audio → preview → publication.
 * Persisté dans storage/runs/{runId}/final/publish-package.json.
 * Source de vérité pour la relance propre (C1.3) et le contrôle opérateur (C1.4).
 */
export type PublishPackage = {
  runId: string
  version: 1
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
    platforms: {
      tiktok: { format: string; maxDuration: number }
      youtube_shorts: { format: string; maxDuration: number }
      instagram_reels: { format: string; maxDuration: number }
    }
  }
  generatedAt: string
}

// ─── C1.2 — Dry-run / preflight ────────────────────────────────────────────

export type PreflightCheckStatus = 'ok' | 'warning' | 'error'

export type PreflightCheck = {
  name: string
  status: PreflightCheckStatus
  detail: string
}

export type PreflightNextAction =
  | 'publish'
  | 'fix_credentials'
  | 'run_pipeline'
  | 'check_logs'

export type PreflightReport = {
  ready: boolean
  runId: string
  platform: PublishPlatform
  checks: PreflightCheck[]
  nextAction: PreflightNextAction
  nextActionLabel: string
  generatedAt: string
}

// ─── C1.4 — Contrôle opérateur ─────────────────────────────────────────────

export type PublishControlState =
  | 'not_published'
  | 'published'
  | 'processing'
  | 'failed'
  | 'no_media'
  | 'no_credentials'

export type PublishControlNextAction =
  | 'publish'
  | 'retry'
  | 'fix_credentials'
  | 'run_pipeline'
  | 'manual_check'
  | 'none'

export type PublishControl = {
  runId: string
  state: PublishControlState
  lastResult: import('./tiktok').PublishResult | null
  platformHealth: {
    tiktok: { status: 'ready' | 'no_credentials' | 'error'; details: string }
  }
  nextAction: PublishControlNextAction
  nextActionLabel: string
  failureReason?: string
  publishedAt?: string
  generatedAt: string
}
