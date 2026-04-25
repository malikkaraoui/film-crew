import { readFile, writeFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { logger } from '@/lib/logger'
import { savePublishResult } from '@/lib/publishers/tiktok'
import { publishToPlatform, upsertPublishManifest } from '@/lib/publishers/factory'
import { buildPublishPackage, savePublishPackage } from '@/lib/publishers/publish-package'
import type { PipelineStep, StepContext, StepResult } from '../types'

type PreviewManifest = {
  mode: 'video_finale' | 'animatic' | 'storyboard_only' | 'none'
  playableFilePath: string | null
  mediaType: string | null
  readyForAssembly: boolean
  hasAudio: boolean
}

type AudioMasterManifestRef = {
  masterFilePath: string
  totalDurationS: number
  scenes: { sceneIndex: number }[]
  generatedAt: string
}

export const step8Publish: PipelineStep = {
  name: 'Publication',
  stepNumber: 10,

  async execute(ctx: StepContext): Promise<StepResult> {
    const finalDir = join(ctx.storagePath, 'final')
    let previewManifest: PreviewManifest

    try {
      const raw = await readFile(join(ctx.storagePath, 'preview-manifest.json'), 'utf-8')
      previewManifest = JSON.parse(raw)
    } catch {
      return { success: false, costEur: 0, outputData: null, error: 'preview-manifest.json introuvable' }
    }

    const { mode, playableFilePath } = previewManifest
    const hasPlayable = !!(playableFilePath)

    if (mode === 'none' && !hasPlayable) {
      logger.warn({ event: 'publish_no_media', runId: ctx.runId, mode })
    }

    // Lire l'audio-master-manifest pour la traçabilité audio → publication
    let audioManifest: AudioMasterManifestRef | null = null
    try {
      const raw = await readFile(join(ctx.storagePath, 'audio', 'audio-master-manifest.json'), 'utf-8')
      audioManifest = JSON.parse(raw)
    } catch {
      logger.warn({ event: 'publish_no_audio_manifest', runId: ctx.runId })
    }

    // Lire structure.json pour titre et hashtags
    const structure = await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8')
      .then((raw) => JSON.parse(raw))
      .catch(() => ({ title: ctx.idea, scenes: [], hashtags: undefined }))

    const title = structure.title || ctx.idea
    // Utiliser les hashtags de structure si disponibles, sinon defaults
    const hashtags: string[] = Array.isArray(structure.hashtags) && structure.hashtags.length > 0
      ? structure.hashtags
      : ['#shorts', '#ai', '#filmcrew']
    const description = `${title} — Généré par FILM-CREW`

    // Écrire metadata.json enrichi
    const metadata = {
      title,
      description,
      hashtags,
      mode,
      mediaFile: playableFilePath
        ? `final/${mode === 'video_finale' ? 'video.mp4' : 'animatic.mp4'}`
        : null,
      audioSource: audioManifest
        ? { masterPath: audioManifest.masterFilePath, totalDurationS: audioManifest.totalDurationS }
        : null,
      platforms: {
        tiktok: { format: '9:16', maxDuration: 180 },
        youtube_shorts: { format: '9:16', maxDuration: 60 },
        instagram_reels: { format: '9:16', maxDuration: 90 },
      },
      generatedAt: new Date().toISOString(),
    }

    await writeFile(
      join(finalDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
    )

    // C1.1 — Construire et persister le publish-package canonique
    const pkg = buildPublishPackage({
      runId: ctx.runId,
      audio: audioManifest
        ? {
            masterPath: audioManifest.masterFilePath,
            totalDurationS: audioManifest.totalDurationS,
            sceneCount: audioManifest.scenes?.length ?? 0,
            generatedAt: audioManifest.generatedAt,
          }
        : {
            masterPath: '',
            totalDurationS: 0,
            sceneCount: 0,
            generatedAt: new Date().toISOString(),
          },
      preview: {
        mode,
        playableFilePath,
        hasAudio: previewManifest.hasAudio,
      },
      publication: { title, description, hashtags },
    })

    await savePublishPackage(ctx.runId, pkg, finalDir)

    logger.info({
      event: 'publish_package_written',
      runId: ctx.runId,
      audioLinked: !!audioManifest,
      mode,
    })

    // Tenter la publication TikTok (plateforme par défaut du pipeline)
    const videoPath = playableFilePath
      ? (isAbsolute(playableFilePath)
        ? playableFilePath
        : join(process.cwd(), playableFilePath.replace(/^\//, '')))
      : join(ctx.storagePath, 'final', mode === 'video_finale' ? 'video.mp4' : 'animatic.mp4')

    const publishResult = await publishToPlatform('tiktok', {
      runId: ctx.runId,
      videoPath,
      title,
      hashtags,
      mediaMode: mode,
    })

    // Persister : publish-result.json (dernière pub) + publish-manifest.json (historique)
    await savePublishResult(ctx.runId, publishResult, finalDir)
    await upsertPublishManifest(ctx.runId, publishResult, { title, hashtags }, ctx.storagePath)

    logger.info({
      event: 'publish_ready',
      runId: ctx.runId,
      title,
      mode,
      hasPlayable,
      audioLinked: !!audioManifest,
      tiktokStatus: publishResult.status,
      publishId: publishResult.publishId,
    })

    return {
      success: true,
      costEur: 0,
      outputData: {
        title,
        mode,
        hasPlayable,
        mediaFile: metadata.mediaFile,
        audioLinked: !!audioManifest,
        platforms: Object.keys(metadata.platforms),
        tiktokStatus: publishResult.status,
        publishId: publishResult.publishId,
        status: hasPlayable ? 'ready_for_export' : 'metadata_only',
      },
    }
  },
}
