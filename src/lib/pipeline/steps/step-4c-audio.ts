import { readFile, mkdir, copyFile, rm } from 'fs/promises'
import { join } from 'path'
import { renderDialogueToTTS } from '@/lib/pipeline/tts-renderer'
import { assembleSceneTTS } from '@/lib/audio/tts-render'
import { mixScene, DEFAULT_MIX_VOLUMES } from '@/lib/audio/mix-scene'
import { assembleMaster } from '@/lib/audio/mix-master'
import { logger } from '@/lib/logger'
import type { DialogueScene, DialogueScript, SceneAudioPackage } from '@/types/audio'
import type { SceneMixInput } from '@/lib/audio/mix-master'
import type { PipelineStep, StepContext, StepResult } from '../types'

// ─── dialogueSceneToPackage ───

export function dialogueSceneToPackage(scene: DialogueScene, runId: string): SceneAudioPackage {
  return {
    version: '1.0',
    runId,
    sceneIndex: scene.sceneIndex,
    title: scene.title,
    narration: { lines: scene.lines, silences: scene.silences, stageDirections: scene.stageDirections },
    intention: { emotion: 'neutre', narrativeRole: 'standard', tensionLevel: 50, videoPromptHint: scene.title },
    ambiance: { description: 'none', intensity: 'subtle', stereoWidth: 'narrow' },
    fx: [],
    music: {
      mood: 'neutre',
      tempo: 'moderate',
      intensity: 0,
      instrumentation: 'none',
      placement: 'under_dialogue',
      volumeRelativeToDialogue: 'background',
    },
    timing: {
      targetDurationS: scene.durationTargetS,
      minDurationS: Math.max(1, scene.durationTargetS * 0.7),
      maxDurationS: scene.durationTargetS * 1.3,
      transitionIn: { type: 'cut', durationMs: 0 },
      transitionOut: { type: 'cut', durationMs: 0 },
    },
    dependencies: {
      continuesAmbianceFrom: null,
      continuesMusicFrom: null,
      requiredBeforeScene: [],
      sharedSpeakers: [...new Set(scene.lines.map((l) => l.speaker))],
    },
  }
}

// ─── cleanupStaleAudioArtifacts ───

export async function cleanupStaleAudioArtifacts(storagePath: string): Promise<void> {
  await rm(join(storagePath, 'audio', 'audio-master-manifest.json'), { force: true }).catch(() => {})
  await rm(join(storagePath, 'audio', 'master.wav'), { force: true }).catch(() => {})
  await rm(join(storagePath, 'audio', 'scenes'), { recursive: true, force: true }).catch(() => {})
}

// ─── step4cAudio ───

export const step4cAudio: PipelineStep = {
  name: 'Audio Package',
  stepNumber: 6,

  async execute(ctx: StepContext): Promise<StepResult> {
    const { storagePath, runId } = ctx
    const audioDir = join(storagePath, 'audio')
    const ttsDir = join(storagePath, 'tts')

    logger.info({ event: 'audio_step_start', runId })

    // 1. Cleanup stale artifacts
    await cleanupStaleAudioArtifacts(storagePath)

    // 2. Read dialogue_script.json
    let script: DialogueScript
    try {
      const raw = await readFile(join(storagePath, 'dialogue_script.json'), 'utf-8')
      script = JSON.parse(raw) as DialogueScript
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        logger.info({ event: 'audio_step_skipped', runId, reason: 'dialogue_script.json absent' })
        return { success: true, costEur: 0, outputData: { skipped: true, reason: 'dialogue_script.json absent' } }
      }
      throw err
    }

    if (!script.scenes || script.scenes.length === 0) {
      logger.info({ event: 'audio_step_skipped', runId, reason: 'script vide' })
      return { success: true, costEur: 0, outputData: { skipped: true, reason: 'script vide' } }
    }

    // 3. Render TTS
    const ttsManifest = await renderDialogueToTTS({ storagePath, runId })
    if (ttsManifest === null) {
      logger.info({ event: 'audio_step_skipped', runId, reason: 'Aucun provider TTS disponible' })
      return {
        success: true,
        costEur: 0,
        outputData: { ttsUnavailable: true, reason: 'Aucun provider TTS disponible' },
      }
    }

    // 4. Process each scene
    const sceneMixInputs: SceneMixInput[] = []
    let totalCost = 0

    for (const scene of script.scenes) {
      const pkg = dialogueSceneToPackage(scene, runId)
      const sceneOutputDir = join(audioDir, 'scenes', String(scene.sceneIndex))

      await mkdir(sceneOutputDir, { recursive: true })

      const sceneTTS = await assembleSceneTTS({
        scene: pkg,
        ttsManifest,
        ttsDir,
        outputDir: sceneOutputDir,
      })

      const mixPath = join(sceneOutputDir, 'mix.wav')

      try {
        await mixScene({
          ttsPath: sceneTTS.concatFilePath,
          ambiancePath: null,
          fxPaths: [],
          musicPath: null,
          outputPath: mixPath,
          volumes: DEFAULT_MIX_VOLUMES,
          targetDurationS: pkg.timing.targetDurationS,
        })
      } catch (mixErr) {
        logger.warn({
          event: 'audio_mix_fallback',
          runId,
          sceneIndex: scene.sceneIndex,
          error: (mixErr as Error).message,
        })
        await copyFile(sceneTTS.concatFilePath, mixPath)
      }

      totalCost += sceneTTS.costEur

      sceneMixInputs.push({
        sceneIndex: scene.sceneIndex,
        durationS: sceneTTS.totalDurationS,
        ttsFilePath: sceneTTS.concatFilePath,
        mixFilePath: mixPath,
        ttsProvider: sceneTTS.provider,
        costEur: sceneTTS.costEur,
      })

      logger.info({
        event: 'audio_scene_processed',
        runId,
        sceneIndex: scene.sceneIndex,
        durationS: sceneTTS.totalDurationS,
      })
    }

    // 5. Assemble master
    try {
      const masterManifest = await assembleMaster({
        scenes: sceneMixInputs,
        outputDir: audioDir,
        runId,
      })

      logger.info({
        event: 'audio_step_complete',
        runId,
        totalDurationS: masterManifest.totalDurationS,
        sceneCount: sceneMixInputs.length,
      })

      return {
        success: true,
        costEur: totalCost,
        outputData: {
          masterFilePath: masterManifest.masterFilePath,
          totalDurationS: masterManifest.totalDurationS,
          sceneCount: sceneMixInputs.length,
          ttsProvider: ttsManifest.provider,
        },
      }
    } catch (assemblyErr) {
      logger.warn({
        event: 'audio_assembly_failed',
        runId,
        error: (assemblyErr as Error).message,
      })
      return {
        success: true,
        costEur: totalCost,
        outputData: {
          assemblyFailed: true,
          reason: (assemblyErr as Error).message,
        },
      }
    }
  },
}
