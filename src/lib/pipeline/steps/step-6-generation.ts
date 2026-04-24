import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import { db } from '@/lib/db/connection'
import { clip } from '@/lib/db/schema'
import type { VideoProvider, TTSProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'
import type { PipelineStep, StepContext, StepResult } from '../types'
import { readProjectConfig } from '@/lib/runs/project-config'
import { pickBackgroundMusic } from '@/lib/providers/music/local-music'
import type { ProviderPromptMap } from '@/lib/pipeline/provider-prompting'
import { resolveProviderPrompt } from '@/lib/pipeline/provider-prompting'

type PromptEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt?: string
  providerPrompts?: ProviderPromptMap
}

export const step6Generation: PipelineStep = {
  name: 'Génération',
  stepNumber: 8,

  async execute(ctx: StepContext): Promise<StepResult> {
    const projectConfig = await readProjectConfig(ctx.storagePath)
    const referenceImageUrls = projectConfig?.referenceImages?.urls ?? []
    const generationMode = projectConfig?.generationMode ?? 'manual'

    if (generationMode !== 'automatic') {
      await writeFile(
        join(ctx.storagePath, 'generation-manifest.json'),
        JSON.stringify({
          clips: [],
          audioPath: null,
          musicPath: null,
          generationMode: 'manual',
          note: 'Génération provider désactivée en automatique — lancer manuellement scène par scène.',
          generatedAt: new Date().toISOString(),
        }, null, 2),
      )

      logger.warn({
        event: 'generation_manual_mode_skip',
        runId: ctx.runId,
        message: 'Étape 6 sautée en mode manuel pour éviter tout appel provider automatique',
      })

      return {
        success: true,
        costEur: 0,
        outputData: {
          clipCount: 0,
          totalPrompts: 0,
          hasAudio: false,
          generationMode: 'manual',
          autoGenerationSkipped: true,
        },
      }
    }

    // Lire les prompts
    let promptData: { prompts: PromptEntry[] }
    try {
      const raw = await readFile(join(ctx.storagePath, 'prompts.json'), 'utf-8')
      promptData = JSON.parse(raw)
    } catch {
      return { success: false, costEur: 0, outputData: null, error: 'prompts.json introuvable' }
    }

    let totalCost = 0
    const generatedClips: {
      sceneIndex: number
      filePath: string
      seed?: number
      costEur: number
      providerUsed: string
      failoverOccurred: boolean
      failoverChain?: { original: string; fallback: string; reason: string }
    }[] = []

    // Générer les clips vidéo
    for (const entry of promptData.prompts) {
      try {
        const clipsDir = join(ctx.storagePath, 'clips')
        const { result, provider, failover } = await executeWithFailover(
          'video',
          async (p) => {
            const video = p as VideoProvider
            if (video.name === 'sketch-local') {
              throw new Error('sketch-local est désactivé pour le pipeline standard : brouillon texte local non acceptable comme clip final')
            }
            const resolvedPrompt = resolveProviderPrompt(entry.providerPrompts, video.name, entry.prompt)
            return video.generate(resolvedPrompt, {
              resolution: '720p',
              duration: 10,
              aspectRatio: '9:16',
              referenceImageUrls,
              outputDir: clipsDir,
            })
          },
          ctx.runId,
        )

        totalCost += result.costEur

        // Persister le clip en DB
        await db.insert(clip).values({
          id: crypto.randomUUID(),
          runId: ctx.runId,
          stepIndex: entry.sceneIndex,
          prompt: resolveProviderPrompt(entry.providerPrompts, provider.name, entry.prompt),
          provider: provider.name,
          status: 'completed',
          filePath: result.filePath,
          seed: result.seed,
          costEur: result.costEur,
        })

        generatedClips.push({
          sceneIndex: entry.sceneIndex,
          filePath: result.filePath,
          seed: result.seed,
          costEur: result.costEur,
          providerUsed: provider.name,
          failoverOccurred: !!failover,
          ...(failover ? { failoverChain: { original: failover.original, fallback: failover.fallback, reason: failover.reason } } : {}),
        })

        logger.info({
          event: 'clip_generated',
          runId: ctx.runId,
          sceneIndex: entry.sceneIndex,
          providerUsed: provider.name,
          failoverOccurred: !!failover,
          costEur: result.costEur,
        })
      } catch (e) {
        logger.error({
          event: 'clip_generation_failed',
          runId: ctx.runId,
          sceneIndex: entry.sceneIndex,
          error: (e as Error).message,
        })

        await db.insert(clip).values({
          id: crypto.randomUUID(),
          runId: ctx.runId,
          stepIndex: entry.sceneIndex,
          prompt: entry.prompt,
          provider: 'video',
          status: 'failed',
          retries: 1,
        })
      }
    }

    // Générer la voix TTS
    let audioPath: string | null = null
    try {
      const structure = JSON.parse(
        await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8'),
      )
      const narration = structure.scenes
        .map((s: { dialogue: string }) => s.dialogue)
        .filter(Boolean)
        .join(' ')

      if (narration) {
        const { result } = await executeWithFailover(
          'tts',
          async (p) => {
            const tts = p as TTSProvider
            return tts.synthesize(narration, 'default', 'fr', ctx.storagePath)
          },
          ctx.runId,
        )
        totalCost += result.costEur
        audioPath = result.filePath
      }
    } catch (e) {
      logger.warn({ event: 'tts_failed', runId: ctx.runId, error: (e as Error).message })
    }

    // Sélection musique de fond
    let musicPath: string | null = null
    try {
      const structure = JSON.parse(
        await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8'),
      )
      const tone = structure.tone ?? structure.style ?? undefined
      musicPath = await pickBackgroundMusic(tone, ctx.runId)
      if (musicPath) {
        logger.info({ event: 'music_selected', runId: ctx.runId, path: musicPath, tone })
      }
    } catch (e) {
      logger.warn({ event: 'music_selection_failed', runId: ctx.runId, error: (e as Error).message })
    }

    // Sauvegarder le manifest de génération
    await writeFile(
      join(ctx.storagePath, 'generation-manifest.json'),
      JSON.stringify({
        clips: generatedClips,
        audioPath,
        musicPath,
        generatedAt: new Date().toISOString(),
      }, null, 2),
    )

    return {
      success: true, // on continue même avec 0 clips — les providers vidéo sont optionnels en V1
      costEur: totalCost,
      outputData: {
        clipCount: generatedClips.length,
        totalPrompts: promptData.prompts.length,
        hasAudio: !!audioPath,
      },
    }
  },
}
