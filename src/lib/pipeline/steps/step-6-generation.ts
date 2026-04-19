import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import { db } from '@/lib/db/connection'
import { clip } from '@/lib/db/schema'
import type { VideoProvider, TTSProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'
import type { PipelineStep, StepContext, StepResult } from '../types'

type PromptEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt?: string
}

export const step6Generation: PipelineStep = {
  name: 'Génération',
  stepNumber: 6,

  async execute(ctx: StepContext): Promise<StepResult> {
    // Lire les prompts
    let promptData: { prompts: PromptEntry[] }
    try {
      const raw = await readFile(join(ctx.storagePath, 'prompts.json'), 'utf-8')
      promptData = JSON.parse(raw)
    } catch {
      return { success: false, costEur: 0, outputData: null, error: 'prompts.json introuvable' }
    }

    let totalCost = 0
    const generatedClips: { sceneIndex: number; filePath: string; seed?: number; costEur: number }[] = []

    // Générer les clips vidéo
    for (const entry of promptData.prompts) {
      try {
        const clipsDir = join(ctx.storagePath, 'clips')
        const { result } = await executeWithFailover(
          'video',
          async (p) => {
            const video = p as VideoProvider
            return video.generate(entry.prompt, {
              resolution: '720p',
              duration: 10,
              aspectRatio: '9:16',
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
          prompt: entry.prompt,
          provider: 'video',
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
        })

        logger.info({
          event: 'clip_generated',
          runId: ctx.runId,
          sceneIndex: entry.sceneIndex,
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

    // Sauvegarder le manifest de génération
    await writeFile(
      join(ctx.storagePath, 'generation-manifest.json'),
      JSON.stringify({
        clips: generatedClips,
        audioPath,
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
