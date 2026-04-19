import { readFile, writeFile, access, mkdir } from 'fs/promises'
import { join } from 'path'
import { logger } from '@/lib/logger'
import type { PipelineStep, StepContext, StepResult } from '../types'

export const step7Preview: PipelineStep = {
  name: 'Preview',
  stepNumber: 7,

  async execute(ctx: StepContext): Promise<StepResult> {
    // Lire le manifest de génération
    let genManifest: { clips: { sceneIndex: number; filePath: string }[]; audioPath: string | null }
    try {
      const raw = await readFile(join(ctx.storagePath, 'generation-manifest.json'), 'utf-8')
      genManifest = JSON.parse(raw)
    } catch {
      return { success: false, costEur: 0, outputData: null, error: 'generation-manifest.json introuvable' }
    }

    // Lire le storyboard manifest pour inclure les images dans le preview
    let storyboardImages: { sceneIndex: number; filePath: string; status: string }[] = []
    try {
      const raw = await readFile(join(ctx.storagePath, 'storyboard', 'manifest.json'), 'utf-8')
      storyboardImages = JSON.parse(raw).images ?? []
    } catch { /* pas de storyboard */ }

    // Vérifier les clips vidéo existants
    const validClips: string[] = []
    for (const clip of genManifest.clips) {
      try {
        await access(clip.filePath)
        validClips.push(clip.filePath)
      } catch {
        logger.warn({ event: 'clip_missing', runId: ctx.runId, path: clip.filePath })
      }
    }

    // Sécuriser le dossier final/
    const finalDir = join(ctx.storagePath, 'final')
    await mkdir(finalDir, { recursive: true })

    // Générer le fichier concat si des clips existent
    const concatPath = join(finalDir, 'concat.txt')
    if (validClips.length > 0) {
      const concatList = validClips.map((p) => `file '${p}'`).join('\n')
      await writeFile(concatPath, concatList)
    }

    // Sauvegarder le manifest preview — reflète la réalité du run
    const previewManifest = {
      clips: validClips,
      storyboardImages: storyboardImages.filter(i => i.status === 'generated').map(i => i.filePath),
      audioPath: genManifest.audioPath,
      concatPath: validClips.length > 0 ? concatPath : null,
      readyForAssembly: validClips.length > 0,
      hasStoryboard: storyboardImages.some(i => i.status === 'generated'),
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
        validClipCount: validClips.length,
        totalClips: genManifest.clips.length,
        hasAudio: !!genManifest.audioPath,
        hasStoryboard: previewManifest.hasStoryboard,
        readyForAssembly: previewManifest.readyForAssembly,
      },
    }
  },
}
