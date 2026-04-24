import { writeFile } from 'fs/promises'
import { join } from 'path'
import { renderDialogueToTTS } from './tts-renderer'
import { assembleDialogueAudio } from './audio-assembler'
import { upsertAudioAsset } from '@/lib/db/queries/audio-assets'
import type { AudioPreviewManifest } from '@/types/audio'
import { logger } from '@/lib/logger'

// ─── Types ───

export type AudioManifestResult = {
  manifest: AudioPreviewManifest
  audioPreviewPath: string
}

// ─── Core ───

/**
 * Orchestre le pipeline audio complet :
 * 1. TTS multi-lignes (B2a) → tts_manifest.json + WAV par ligne
 * 2. Assemblage dialogues + silences (B2b) → audio_preview.wav + audio_timeline.json
 * 3. Manifest + persist DB (B2c) → audio_preview_manifest.json + audioAsset row
 *
 * Retourne null si une étape échoue (les étapes précédentes sont cleanup-safe).
 */
export async function buildAudioPreview(params: {
  storagePath: string
  runId: string
  language?: string
  voice?: string
}): Promise<AudioManifestResult | null> {
  const { storagePath, runId, language, voice } = params

  // ── Étape 1 : TTS multi-lignes ──
  const ttsManifest = await renderDialogueToTTS({ storagePath, runId, language, voice })

  if (!ttsManifest) {
    logger.warn({ event: 'audio_manifest_tts_failed', runId })
    return null
  }

  // ── Étape 2 : Assemblage ──
  const assembly = await assembleDialogueAudio({ storagePath, runId })

  if (!assembly) {
    logger.warn({ event: 'audio_manifest_assembly_failed', runId })
    return null
  }

  // ── Étape 3 : Manifest ──
  const manifest: AudioPreviewManifest = {
    runId,
    filePath: assembly.audioPreviewPath,
    durationS: assembly.totalDurationS,
    sampleRate: 24000,
    channels: 1,
    ttsProvider: ttsManifest.provider,
    ttsModel: ttsManifest.voice,
    musicSources: [],   // B3 — pas encore implémenté
    fxSources: [],      // B3 — pas encore implémenté
    generatedAt: new Date().toISOString(),
    timeline: assembly.timeline,
  }

  await writeFile(
    join(storagePath, 'audio_preview_manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  // ── Persist DB ──
  await upsertAudioAsset({
    id: `audio-preview-${runId}`,
    runId,
    type: 'audio_preview',
    data: {
      durationS: manifest.durationS,
      ttsProvider: manifest.ttsProvider,
      segmentCount: manifest.timeline.segments.length,
      dialogueSegments: manifest.timeline.segments.filter((s) => s.type === 'dialogue').length,
    },
    filePath: manifest.filePath,
    durationS: manifest.durationS,
    status: 'assembled',
  }).catch((error) => {
    // DB persist non bloquant — le fichier est la source de vérité
    logger.warn({
      event: 'audio_manifest_db_persist_failed',
      runId,
      error: (error as Error).message,
    })
  })

  logger.info({
    event: 'audio_manifest_complete',
    runId,
    durationS: manifest.durationS,
    ttsProvider: manifest.ttsProvider,
    segmentCount: manifest.timeline.segments.length,
  })

  return { manifest, audioPreviewPath: assembly.audioPreviewPath }
}
