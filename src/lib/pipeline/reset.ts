import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { deleteAgentTraces } from '@/lib/db/queries/traces'
import { deleteClipsForRun, resetRunStepsFromStep, updateRunStatus } from '@/lib/db/queries/runs'

const STEP_ARTIFACTS: Record<number, string[]> = {
  2: ['brief.json'],
  3: ['structure.json', 'structure-raw.txt', 'director-plan.json', 'dialogue_script.json'],
  4: ['storyboard-blueprint.json', 'storyboard-blueprint-raw.txt'],
  5: ['storyboard', 'failover-log.json'],
  6: ['prompts.json', 'prompt-manifest.json'],
  7: ['generation-manifest.json', 'clips', 'audio', 'tts', 'tts_manifest.json', 'subtitles'],
  8: ['preview-manifest.json', 'final'],
  9: ['publish-manifest.json'],
}

const CORE_DIRECTORIES = ['clips', 'audio', 'subtitles', 'storyboard', 'final']

async function cleanupArtifactsFromStep(storagePath: string, stepNumber: number): Promise<void> {
  for (const [rawStep, relativePaths] of Object.entries(STEP_ARTIFACTS)) {
    if (Number(rawStep) < stepNumber) continue

    for (const relativePath of relativePaths) {
      await rm(join(storagePath, relativePath), { recursive: true, force: true }).catch(() => {})
    }
  }

  await Promise.all(
    CORE_DIRECTORIES.map((dir) => mkdir(join(storagePath, dir), { recursive: true })),
  )
}

export async function resetRunFromStep(params: {
  runId: string
  storagePath: string
  stepNumber: number
}): Promise<void> {
  const { runId, storagePath, stepNumber } = params

  await resetRunStepsFromStep(runId, stepNumber)

  if (stepNumber <= 2) {
    await deleteAgentTraces(runId)
  }

  if (stepNumber <= 7) {
    await deleteClipsForRun(runId)
  }

  await cleanupArtifactsFromStep(storagePath, stepNumber)
  await updateRunStatus(runId, 'pending', stepNumber)
}
