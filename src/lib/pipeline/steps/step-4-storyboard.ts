import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { ImageProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'
import type { PipelineStep, StepContext, StepResult } from '../types'

type Scene = {
  index: number
  description: string
  dialogue: string
  camera: string
  lighting: string
  duration_s: number
}

type StoryboardImage = {
  sceneIndex: number
  description: string
  filePath: string
  status: 'pending' | 'generated' | 'validated' | 'rejected'
}

export const step4Storyboard: PipelineStep = {
  name: 'Storyboard',
  stepNumber: 4,

  async execute(ctx: StepContext): Promise<StepResult> {
    // Lire la structure JSON de l'étape précédente
    let structure: { scenes: Scene[] }
    try {
      const raw = await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8')
      structure = JSON.parse(raw)
    } catch {
      return {
        success: false,
        costEur: 0,
        outputData: null,
        error: 'Fichier structure.json introuvable — l\'étape 3 a échoué ?',
      }
    }

    const images: StoryboardImage[] = []
    let totalCost = 0

    for (const scene of structure.scenes) {
      const prompt = `${scene.description}. ${scene.lighting}. ${scene.camera}. Style: cinématique, vidéo courte.`

      try {
        const storyboardDir = join(ctx.storagePath, 'storyboard')
        const { result } = await executeWithFailover(
          'image',
          async (p) => {
            const img = p as ImageProvider
            return img.generate(prompt, { width: 768, height: 1344, style: 'cinematic', outputDir: storyboardDir })
          },
          ctx.runId,
        )

        totalCost += result.costEur

        images.push({
          sceneIndex: scene.index,
          description: scene.description,
          filePath: result.filePath,
          status: 'generated',
        })
      } catch (e) {
        logger.warn({
          event: 'storyboard_image_failed',
          runId: ctx.runId,
          sceneIndex: scene.index,
          error: (e as Error).message,
        })

        // Créer un placeholder pour les images qui échouent
        const placeholderPath = join(ctx.storagePath, 'storyboard', `scene-${scene.index}-placeholder.txt`)
        await writeFile(placeholderPath, `[Image non générée]\n${prompt}`)

        images.push({
          sceneIndex: scene.index,
          description: scene.description,
          filePath: placeholderPath,
          status: 'pending',
        })
      }
    }

    // Sauvegarder le manifest storyboard
    const manifest = { images, generatedAt: new Date().toISOString() }
    await writeFile(
      join(ctx.storagePath, 'storyboard', 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    )

    const allGenerated = images.every((img) => img.status === 'generated')

    return {
      success: true, // on continue même si certaines images ont échoué
      costEur: totalCost,
      outputData: {
        imageCount: images.length,
        generatedCount: images.filter((i) => i.status === 'generated').length,
        allGenerated,
      },
    }
  },
}
