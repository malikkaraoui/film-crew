import { readFile, writeFile, access, mkdir, unlink } from 'fs/promises'
import { join, extname } from 'path'
import { spawn } from 'child_process'
import { logger } from '@/lib/logger'
import type { PipelineStep, StepContext, StepResult } from '../types'
import { detectEncoder, encoderArgs, probeMediaDuration, checkLibass } from '../ffmpeg-media'
import { buildFilterGraph, type PreviewPipelineConfig } from '../ffmpeg-graph'
import { sanitizeTransitionConfig, DEFAULT_TRANSITION, DEFAULT_TRANSITION_DURATION, type XfadeTransition, type TransitionConfig } from '../ffmpeg-transitions'
import { generateSRT, type SubtitleStyle } from '../subtitles'

// Taxonomie fixe (registre risques R6) :
//   video_finale  = clips vidéo réels assemblés
//   animatic      = slideshow storyboard + audio
//   storyboard_only = storyboard sans audio
//   none          = aucun artefact visuel
export type MediaMode = 'video_finale' | 'animatic' | 'storyboard_only' | 'none'

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const SECONDS_PER_IMAGE = 3

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`))
    })
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn: ${err.message}`)))
  })
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

// ─── Assemblage video_finale enrichi ─────────────────────────────────────────

/**
 * Assemble les clips vidéo avec features optionnelles :
 * - Transitions xfade entre clips (si enabled + >1 clip)
 * - Mix musique de fond (narration 1.0, musique 0.12)
 * - Sous-titres brûlés (si SRT + libass)
 * - Encodeur GPU adaptatif avec fallback libx264
 *
 * INVARIANT : si une feature échoue, retombe sur le concat simple existant.
 */
async function assembleVideoFinale(
  clips: string[],
  concatPath: string,
  audioPath: string | null,
  musicPath: string | null,
  srtPath: string | null,
  outputPath: string,
  transitionConfig: TransitionConfig,
  subtitleStyle: SubtitleStyle,
): Promise<{ encoderUsed: string; transitionsEnabled: boolean; subtitlesEnabled: boolean }> {
  if (clips.length === 0) throw new Error('Aucun clip à assembler')

  // Résoudre l'encodeur
  let encoder = await detectEncoder()
  logger.info({ event: 'encoder_detected', encoder })

  // Mesurer les durées des clips
  const clipDurations = await Promise.all(clips.map((c) => probeMediaDuration(c, 10)))

  // Sanitize transition config
  const { enabled: transitionsEnabled, config: sanitizedTransition } =
    sanitizeTransitionConfig(clips.length, clipDurations, transitionConfig)

  // Vérifier libass pour les sous-titres
  let subtitlesEnabled = !!srtPath
  if (srtPath) {
    const hasLibass = await checkLibass()
    if (!hasLibass) {
      logger.warn({ event: 'libass_absent', message: 'FFmpeg sans libass — sous-titres désactivés' })
      subtitlesEnabled = false
      srtPath = null
    }
  }

  // Tentative avec features avancées via le graphe unifié
  try {
    const pipelineConfig: PreviewPipelineConfig = {
      clips,
      clipDurations,
      audioPath,
      musicPath,
      srtPath: subtitlesEnabled ? srtPath : null,
      transition: {
        enabled: transitionsEnabled,
        type: sanitizedTransition.type,
        duration: sanitizedTransition.duration,
      },
      subtitleStyle,
      encoder,
      outputPath,
    }

    const { args } = buildFilterGraph(pipelineConfig)
    await runFFmpeg(args)

    if (await fileExists(outputPath)) {
      return { encoderUsed: encoder, transitionsEnabled, subtitlesEnabled }
    }
  } catch (e) {
    logger.warn({
      event: 'advanced_assembly_failed',
      error: (e as Error).message,
      message: 'Fallback vers concat simple',
    })
  }

  // ─── FALLBACK : concat simple (chemin existant d'origine) ──────────────
  encoder = 'libx264'
  try {
    const args = ['-f', 'concat', '-safe', '0', '-i', concatPath]
    if (audioPath) {
      args.push('-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-shortest')
    } else {
      args.push('-c', 'copy')
    }
    args.push('-y', outputPath)
    await runFFmpeg(args)
  } catch (fallbackErr) {
    throw new Error(`Assemblage fallback échoué: ${(fallbackErr as Error).message}`)
  }

  return { encoderUsed: 'libx264 (fallback)', transitionsEnabled: false, subtitlesEnabled: false }
}

// ─── Assemblage animatic avec encodeur GPU ────────────────────────────────────

async function assembleAnimatic(
  images: string[],
  audioPath: string | null,
  outputDir: string,
  outputPath: string,
): Promise<string> {
  const lines: string[] = []
  for (const img of images) {
    lines.push(`file '${img}'`)
    lines.push(`duration ${SECONDS_PER_IMAGE}`)
  }
  if (images.length > 0) lines.push(`file '${images[images.length - 1]}'`)
  const imageConcatPath = join(outputDir, '_image_concat.txt')
  await writeFile(imageConcatPath, lines.join('\n'))

  const tempSlide = join(outputDir, '_slide_temp.mp4')
  let encoderUsed = 'libx264'

  try {
    // Encodeur GPU adaptatif avec fallback
    let encoder = await detectEncoder()
    let encArgs = encoderArgs(encoder)

    try {
      await runFFmpeg([
        '-f', 'concat', '-safe', '0', '-i', imageConcatPath,
        '-r', '24',
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
        ...encArgs,
        '-y', tempSlide,
      ])
      encoderUsed = encoder
    } catch (gpuErr) {
      if (encoder !== 'libx264') {
        logger.warn({ event: 'gpu_encoder_failed', encoder, error: (gpuErr as Error).message, message: 'Fallback libx264' })
        encoder = 'libx264'
        encArgs = encoderArgs('libx264')
        await runFFmpeg([
          '-f', 'concat', '-safe', '0', '-i', imageConcatPath,
          '-r', '24',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
          ...encArgs,
          '-y', tempSlide,
        ])
        encoderUsed = 'libx264 (fallback)'
      } else {
        throw gpuErr
      }
    }

    if (audioPath && await fileExists(audioPath)) {
      await runFFmpeg([
        '-i', tempSlide, '-i', audioPath,
        '-c:v', 'copy', '-c:a', 'aac', '-shortest',
        '-y', outputPath,
      ])
    } else {
      await runFFmpeg(['-i', tempSlide, '-c', 'copy', '-y', outputPath])
    }
  } finally {
    await unlink(tempSlide).catch(() => {})
    await unlink(imageConcatPath).catch(() => {})
  }

  return encoderUsed
}

// ─── Step principale ─────────────────────────────────────────────────────────

export const step7Preview: PipelineStep = {
  name: 'Preview',
  stepNumber: 8,

  async execute(ctx: StepContext): Promise<StepResult> {
    // ─── Lecture des manifests ────────────────────────────────────────────────
    let genManifest: {
      clips: { sceneIndex: number; filePath: string }[]
      audioPath: string | null
      musicPath?: string | null
    }
    try {
      const raw = await readFile(join(ctx.storagePath, 'generation-manifest.json'), 'utf-8')
      genManifest = JSON.parse(raw)
    } catch {
      return { success: false, costEur: 0, outputData: null, error: 'generation-manifest.json introuvable' }
    }

    let storyboardImages: { sceneIndex: number; filePath: string; status: string }[] = []
    try {
      const raw = await readFile(join(ctx.storagePath, 'storyboard', 'manifest.json'), 'utf-8')
      storyboardImages = JSON.parse(raw).images ?? []
    } catch { /* pas de storyboard */ }

    // ─── Validation des clips ─────────────────────────────────────────────────
    const validClips: string[] = []
    for (const clip of genManifest.clips) {
      if (await fileExists(clip.filePath)) validClips.push(clip.filePath)
      else logger.warn({ event: 'clip_missing', runId: ctx.runId, path: clip.filePath })
    }

    // ─── Validation des images storyboard ────────────────────────────────────
    const validImages = storyboardImages
      .filter(i => i.status === 'generated' && IMAGE_EXTENSIONS.has(extname(i.filePath).toLowerCase()))
      .map(i => i.filePath)
      .filter(async () => true)

    const realImages: string[] = []
    for (const p of validImages) {
      if (await fileExists(p)) realImages.push(p)
    }

    const audioPath = genManifest.audioPath
    const hasAudio = !!(audioPath && await fileExists(audioPath))

    // ─── Résolution features depuis config/template ──────────────────────────
    const musicPath: string | null = genManifest.musicPath ?? null
    const hasMusicBg = !!(musicPath && await fileExists(musicPath))

    // ─── Dossier final/ ───────────────────────────────────────────────────────
    const finalDir = join(ctx.storagePath, 'final')
    await mkdir(finalDir, { recursive: true })

    // Transition config depuis template (champs additifs, pas transitions[])
    const transitionConfig: TransitionConfig = {
      type: (ctx.template?.previewTransition as XfadeTransition) ?? DEFAULT_TRANSITION,
      duration: ctx.template?.previewTransitionDuration ?? DEFAULT_TRANSITION_DURATION,
    }

    // Sous-titres config
    const enableSubtitles = process.env.ENABLE_SUBTITLES === 'true'
    const subtitleStyle: SubtitleStyle = ctx.template?.previewSubtitleStyle ?? {}

    // ─── Génération SRT si activé ────────────────────────────────────────────
    let srtPath: string | null = null
    if (enableSubtitles && hasAudio) {
      try {
        const structure = JSON.parse(
          await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8'),
        )
        const sceneDialogues = (structure.scenes ?? [])
          .map((s: { dialogue?: string }, i: number) => ({
            sceneIndex: i,
            dialogue: s.dialogue ?? '',
          }))
          .filter((s: { dialogue: string }) => s.dialogue.trim().length > 0)

        if (sceneDialogues.length > 0) {
          const audioDuration = await probeMediaDuration(audioPath!, 60)
          const finalDir = join(ctx.storagePath, 'final')
          srtPath = await generateSRT(sceneDialogues, audioDuration, finalDir)
          logger.info({ event: 'srt_generated', runId: ctx.runId, path: srtPath })
        }
      } catch (e) {
        logger.warn({ event: 'srt_generation_failed', runId: ctx.runId, error: (e as Error).message })
      }
    }

    // ─── Concat.txt pour clips (conservé pour compatibilité + fallback) ──────
    const concatPath = join(finalDir, 'concat.txt')
    if (validClips.length > 0) {
      await writeFile(concatPath, validClips.map(p => `file '${p}'`).join('\n'))
    }

    // ─── Assemblage FFmpeg ────────────────────────────────────────────────────
    let mode: MediaMode = 'none'
    let playableFilePath: string | null = null
    let assemblyError: string | null = null
    let encoderUsed: string | null = null
    let transitionsEnabled = false
    let subtitlesEnabled = false

    if (validClips.length > 0) {
      const outputPath = join(finalDir, 'video.mp4')
      try {
        const result = await assembleVideoFinale(
          validClips,
          concatPath,
          hasAudio ? audioPath! : null,
          hasMusicBg ? musicPath : null,
          srtPath,
          outputPath,
          transitionConfig,
          subtitleStyle,
        )
        encoderUsed = result.encoderUsed
        transitionsEnabled = result.transitionsEnabled
        subtitlesEnabled = result.subtitlesEnabled

        if (await fileExists(outputPath)) {
          mode = 'video_finale'
          playableFilePath = outputPath
          logger.info({ event: 'video_finale_assembled', runId: ctx.runId, path: outputPath, encoderUsed, transitionsEnabled, subtitlesEnabled })
        }
      } catch (e) {
        assemblyError = (e as Error).message
        logger.warn({ event: 'video_finale_failed', runId: ctx.runId, error: assemblyError })
      }
    } else if (realImages.length > 0) {
      const outputPath = join(finalDir, 'animatic.mp4')
      try {
        encoderUsed = await assembleAnimatic(realImages, hasAudio ? audioPath! : null, finalDir, outputPath)
        if (await fileExists(outputPath)) {
          mode = 'animatic'
          playableFilePath = outputPath
          logger.info({ event: 'animatic_assembled', runId: ctx.runId, path: outputPath, encoderUsed })
        }
      } catch (e) {
        assemblyError = (e as Error).message
        logger.warn({ event: 'animatic_failed', runId: ctx.runId, error: assemblyError })
        if (realImages.length > 0) mode = 'storyboard_only'
      }
    } else if (storyboardImages.some(i => i.status === 'generated')) {
      mode = 'storyboard_only'
    }

    // ─── Preview manifest enrichi (GARDER tous les champs existants) ─────────
    const previewManifest = {
      mode,
      mediaType: mode === 'video_finale' ? 'video/mp4' : mode === 'animatic' ? 'video/mp4' : null,
      playableFilePath,
      clips: validClips,
      storyboardImages: storyboardImages
        .filter(i => i.status === 'generated')
        .map(i => i.filePath),
      audioPath: genManifest.audioPath,
      // Champs existants PRÉSERVÉS
      concatPath: validClips.length > 0 ? concatPath : null,
      readyForAssembly: validClips.length > 0,
      hasStoryboard: realImages.length > 0,
      hasAudio,
      assemblyError,
      // Nouveaux champs enrichis
      musicPath: hasMusicBg ? musicPath : null,
      srtPath,
      subtitlesEnabled,
      encoderUsed,
      transitionsEnabled,
      createdAt: new Date().toISOString(),
    }

    await writeFile(
      join(ctx.storagePath, 'preview-manifest.json'),
      JSON.stringify(previewManifest, null, 2),
    )

    return {
      success: true,
      costEur: 0,
      outputData: {
        mode,
        playable: !!playableFilePath,
        validClipCount: validClips.length,
        totalClips: genManifest.clips.length,
        imageCount: realImages.length,
        hasStoryboard: realImages.length > 0,
        readyForAssembly: validClips.length > 0,
        hasAudio,
        assemblyError,
      },
    }
  },
}
