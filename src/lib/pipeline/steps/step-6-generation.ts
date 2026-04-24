import { access, readFile, writeFile } from 'fs/promises'
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

type StructureForAudio = {
  scenes?: { dialogue?: string }[]
  tone?: string
  style?: string
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

async function resolveMasterAudioPath(storagePath: string, runId: string): Promise<string | null> {
  try {
    const raw = await readFile(join(storagePath, 'audio', 'audio-master-manifest.json'), 'utf-8')
    const manifest = JSON.parse(raw) as AudioMasterManifestRef
    const masterFilePath = manifest.masterFilePath ?? null

    if (!masterFilePath) {
      return null
    }

    if (await fileExists(masterFilePath)) {
      logger.info({ event: 'master_audio_reused', runId, path: masterFilePath })
      return masterFilePath
    }

    logger.warn({ event: 'master_audio_missing', runId, path: masterFilePath })
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
    const masterAudioPath = await resolveMasterAudioPath(ctx.storagePath, ctx.runId)

    let structure: StructureForAudio | null = null
    try {
      const raw = await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8')
      structure = JSON.parse(raw) as StructureForAudio
    } catch (e) {
      logger.warn({ event: 'structure_unavailable_for_audio', runId: ctx.runId, error: (e as Error).message })
    }

    if (generationMode !== 'automatic') {
      await writeFile(
        join(ctx.storagePath, 'generation-manifest.json'),
        JSON.stringify({
          clips: [],
          audioPath: masterAudioPath,
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
          hasAudio: !!masterAudioPath,
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

    let audioPath: string | null = masterAudioPath
    if (!audioPath && structure?.scenes?.length) {
      const narration = structure.scenes
        .map((scene) => scene.dialogue ?? '')
        .filter(Boolean)
        .join(' ')

      if (narration) {
        try {
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
        } catch (e) {
          logger.warn({ event: 'tts_failed', runId: ctx.runId, error: (e as Error).message })
        }
      }
    } else if (!audioPath) {
      logger.warn({ event: 'tts_skipped_no_structure', runId: ctx.runId })
    }

    let musicPath: string | null = null
    try {
      const tone = structure?.tone ?? structure?.style ?? undefined
      musicPath = await pickBackgroundMusic(tone, ctx.runId)
      if (musicPath) {
        logger.info({ event: 'music_selected', runId: ctx.runId, path: musicPath, tone })
      }
    } catch (e) {
      logger.warn({ event: 'music_selection_failed', runId: ctx.runId, error: (e as Error).message })
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
