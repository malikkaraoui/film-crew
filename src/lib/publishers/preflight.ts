/**
 * C1.2 — Dry-run / preflight opérable
 *
 * Vérifie tous les prérequis avant publication sans aucun effet de bord.
 * Retourne un rapport lisible : prêt / pas prêt / pourquoi / quoi faire.
 */

import { stat, readFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { tiktokHealthCheck } from './tiktok'
import type { PreflightCheck, PreflightReport, PublishPlatform } from './platform-types'

export async function runPublishPreflight(
  runId: string,
  platform: PublishPlatform,
  storagePath?: string,
): Promise<PreflightReport> {
  const runStoragePath = storagePath ?? join(process.cwd(), 'storage', 'runs', runId)
  const checks: PreflightCheck[] = []

  // ── Check 1 : preview-manifest.json ────────────────────────────────────
  let previewMode: 'video_finale' | 'animatic' | 'storyboard_only' | 'none' = 'none'
  let videoPath: string | null = null

  try {
    const raw = await readFile(join(runStoragePath, 'preview-manifest.json'), 'utf-8')
    const pm = JSON.parse(raw)
    previewMode = pm.mode ?? 'none'
    videoPath = pm.playableFilePath ?? null
    checks.push({
      name: 'preview_manifest',
      status: 'ok',
      detail: `mode=${previewMode}`,
    })
  } catch {
    checks.push({
      name: 'preview_manifest',
      status: 'error',
      detail: "preview-manifest.json introuvable — lancer le pipeline jusqu'à l'étape Preview (step 9)",
    })
  }

  // ── Check 2 : fichier vidéo jouable ────────────────────────────────────
  if (previewMode !== 'none') {
    const absPath = videoPath
      ? (isAbsolute(videoPath) ? videoPath : join(process.cwd(), videoPath.replace(/^\//, '')))
      : join(runStoragePath, 'final', previewMode === 'video_finale' ? 'video.mp4' : 'animatic.mp4')

    try {
      const s = await stat(absPath)
      const isEmpty = s.size === 0
      const sizeMB = (s.size / 1024 / 1024).toFixed(2)
      checks.push({
        name: 'video_file',
        status: isEmpty ? 'warning' : 'ok',
        detail: isEmpty ? `Fichier vidéo présent mais vide (${sizeMB} MB)` : `${sizeMB} MB`,
      })
    } catch {
      checks.push({
        name: 'video_file',
        status: 'error',
        detail: `Fichier vidéo introuvable : ${absPath}`,
      })
    }
  } else {
    // preview_manifest absent ou mode=none : indiquer explicitement qu'aucune vidéo n'est disponible
    const manifestError = checks.find((c) => c.name === 'preview_manifest')?.status === 'error'
    checks.push({
      name: 'video_file',
      status: 'error',
      detail: manifestError
        ? "Impossible de résoudre le fichier vidéo sans preview-manifest.json"
        : "Aucun fichier vidéo disponible — preview mode=none",
    })
  }

  // ── Check 3 : credentials plateforme ───────────────────────────────────
  if (platform === 'tiktok') {
    const health = await tiktokHealthCheck()
    checks.push({
      name: 'credentials',
      status: health.status === 'ready'
        ? 'ok'
        : health.status === 'no_credentials'
        ? 'error'
        : 'warning',
      detail: health.details,
    })
  }

  // ── Check 4 : metadata.json ─────────────────────────────────────────────
  try {
    await readFile(join(runStoragePath, 'final', 'metadata.json'), 'utf-8')
    checks.push({ name: 'metadata', status: 'ok', detail: 'metadata.json présent' })
  } catch {
    checks.push({
      name: 'metadata',
      status: 'warning',
      detail: 'metadata.json absent — titre par défaut utilisé lors de la publication',
    })
  }

  // ── Check 5 : publish-package.json (C1.1) ──────────────────────────────
  try {
    await readFile(join(runStoragePath, 'final', 'publish-package.json'), 'utf-8')
    checks.push({ name: 'publish_package', status: 'ok', detail: 'paquet canonique présent' })
  } catch {
    checks.push({
      name: 'publish_package',
      status: 'warning',
      detail: 'publish-package.json absent — sera créé lors du premier passage en step 10',
    })
  }

  // ── Décision finale ─────────────────────────────────────────────────────
  const hasError = checks.some((c) => c.status === 'error')
  const ready = !hasError

  const credCheck = checks.find((c) => c.name === 'credentials')
  const videoCheck = checks.find((c) => c.name === 'video_file')
  const manifestCheck = checks.find((c) => c.name === 'preview_manifest')

  let nextAction: PreflightReport['nextAction']
  let nextActionLabel: string

  if (!ready) {
    if (credCheck?.status === 'error') {
      nextAction = 'fix_credentials'
      nextActionLabel = `Configurer TIKTOK_ACCESS_TOKEN dans .env.local puis redémarrer l'app`
    } else if (manifestCheck?.status === 'error' || videoCheck?.status === 'error') {
      nextAction = 'run_pipeline'
      nextActionLabel = "Lancer le pipeline jusqu'à l'étape Preview (step 9) pour générer le fichier vidéo"
    } else {
      nextAction = 'check_logs'
      nextActionLabel = 'Vérifier les logs serveur pour identifier le problème exact'
    }
  } else {
    nextAction = 'publish'
    nextActionLabel = `Prêt — POST /api/runs/${runId}/publish { "platform": "${platform}" }`
  }

  return {
    ready,
    runId,
    platform,
    checks,
    nextAction,
    nextActionLabel,
    generatedAt: new Date().toISOString(),
  }
}
