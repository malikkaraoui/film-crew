import { access, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import { db } from '@/lib/db/connection'
import { clip } from '@/lib/db/schema'
import type { VideoProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'
import type { PipelineStep, StepContext, StepResult } from '../types'
import { readProjectConfig } from '@/lib/runs/project-config'
import { resolveMusicFromStructure } from '@/lib/audio/scene-assets'
import type { ProviderPromptMap } from '@/lib/pipeline/provider-prompting'
import { resolveProviderPrompt } from '@/lib/pipeline/provider-prompting'

type PromptEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt?: string
  providerPrompts?: ProviderPromptMap
}

type AudioMasterManifestRef = {
  masterFilePath?: string | null
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Source audio canonique = audio/audio-master-manifest.json produit par step-4c-audio.
 * Aucun fallback TTS — si l'audio est absent, on continue sans audio.
 */
async function resolveMasterAudioPath(storagePath: string, runId: string): Promise<string | null> {
  try {
    const raw = await readFile(join(storagePath, 'audio', 'audio-master-manifest.json'), 'utf-8')
    const manifest = JSON.parse(raw) as AudioMasterManifestRef
    const masterFilePath = manifest.masterFilePath ?? null

    if (!masterFilePath) {
      logger.warn({ event: 'master_audio_manifest_no_path', runId })
      return null
    }

    if (await fileExists(masterFilePath)) {
      logger.info({ event: 'master_audio_reused', runId, path: masterFilePath })
      return masterFilePath
    }

    logger.warn({ event: 'master_audio_file_missing', runId, path: masterFilePath })
    return null
  } catch {
    logger.info({ event: 'generation_master_audio_unavailable', runId })
    return null
  }
}

export const step6Generation: PipelineStep = {
  name: 'Génération',
  stepNumber: 8,

  async execute(ctx: StepContext): Promise<StepResult> {
    const projectConfig = await readProjectConfig(ctx.storagePath)
    const referenceImageUrls = projectConfig?.referenceImages?.urls ?? []
    const generationMode = projectConfig?.generationMode ?? 'manual'

    // Source audio canonique — pas de régénération TTS ici
    const audioPath = await resolveMasterAudioPath(ctx.storagePath, ctx.runId)

    // Source musique canonique — même résolveur que step-4c-audio
    const musicPath = await resolveMusicFromStructure(ctx.storagePath)
    if (musicPath) {
      logger.info({ event: 'generation_music_resolved', runId: ctx.runId, path: musicPath })
    }

    if (generationMode !== 'automatic') {
      await writeFile(
        join(ctx.storagePath, 'generation-manifest.json'),
        JSON.stringify({
          clips: [],
          audioPath,
          musicPath,
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
          hasAudio: !!audioPath,
          generationMode: 'manual',
          autoGenerationSkipped: true,
        },
      }
    }

    let promptData: { prompts: PromptEntry[] }
    try {
      const raw = await readFile(join(ctx.storagePath, 'prompts.json'), 'utf-8')
      promptData = JSON.parse(raw) as { prompts: PromptEntry[] }
    } catch {
      return { success: false, costEur: 0, outputData: null, error: 'prompts.json introuvable' }
    }

    let totalCost = 0
    const clipsDir = join(ctx.storagePath, 'clips')
    const generatedClips: {
      sceneIndex: number
      filePath: string
      seed?: number
      costEur: number
      providerUsed: string
      failoverOccurred: boolean
      failoverChain?: { original: string; fallback: string; reason: string }
    }[] = []

    for (const entry of promptData.prompts) {
      try {
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
          ...(failover
            ? { failoverChain: { original: failover.original, fallback: failover.fallback, reason: failover.reason } }
            : {}),
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

    await writeFile(
      join(ctx.storagePath, 'generation-manifest.json'),
      JSON.stringify(
        {
          clips: generatedClips,
          audioPath,
          musicPath,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )

    return {
      success: true,
      costEur: totalCost,
      outputData: {
        clipCount: generatedClips.length,
        totalPrompts: promptData.prompts.length,
        hasAudio: !!audioPath,
      },
    }
  },
}
