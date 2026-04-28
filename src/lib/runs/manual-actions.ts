import { readFile } from 'fs/promises'
import { join } from 'path'
import { getRunById, getRunSteps, getRunningRun, updateRunStatus } from '@/lib/db/queries/runs'
import { FINAL_PIPELINE_STEP } from '@/lib/pipeline/constants'
import { executeSingleStep } from '@/lib/pipeline/engine'
import { resetRunFromStep } from '@/lib/pipeline/reset'
import { logger } from '@/lib/logger'
import { syncStep2MeetingState } from '@/lib/runs/meeting-sync'
import { normalizeLlmModelForMode } from '@/lib/llm/target'
import {
  getStepLlmConfig,
  isLlmBackedStep,
  normalizeMeetingLlmMode,
  readProjectConfig,
  writeProjectConfig,
} from '@/lib/runs/project-config'

const TERMINAL_EXECUTION_STATUSES = ['completed', 'killed']
const PAID_GENERATION_CONFIRMATION_TEXT = 'GENERATION PAYANTE'

export class RunActionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'RunActionError'
  }
}

export type LaunchCurrentStepInput = {
  llmMode?: 'local' | 'cloud' | 'openrouter'
  llmModel?: string
  confirmPaidGeneration?: boolean
  confirmationText?: string
  acknowledgedSceneCount?: number
}

export async function validateCurrentStep(runId: string) {
  await syncStep2MeetingState(runId)
  const run = await getRunById(runId)

  if (!run) {
    throw new RunActionError('Projet introuvable', 'NOT_FOUND', 404)
  }

  const currentStep = run.currentStep ?? 1
  if (run.status !== 'paused') {
    throw new RunActionError('Ce projet n’attend pas de validation manuelle', 'INVALID_STATE', 409)
  }

  if (currentStep >= FINAL_PIPELINE_STEP) {
    throw new RunActionError('La dernière étape ne nécessite pas de validation supplémentaire', 'INVALID_STATE', 409)
  }

  const steps = await getRunSteps(runId)
  const currentRunStep = steps.find((step) => step.stepNumber === currentStep)

  if (!currentRunStep || currentRunStep.status !== 'completed') {
    throw new RunActionError('Le livrable courant n’est pas terminé, validation impossible', 'INVALID_STATE', 409)
  }

  return updateRunStatus(runId, 'pending', currentStep + 1)
}

export async function launchCurrentStep(runId: string, body: LaunchCurrentStepInput = {}) {
  await syncStep2MeetingState(runId)
  const run = await getRunById(runId)

  if (!run) {
    throw new RunActionError('Projet introuvable', 'NOT_FOUND', 404)
  }

  if (run.status === 'running') {
    throw new RunActionError('Une étape est déjà en cours sur ce projet', 'INVALID_STATE', 409)
  }

  if (TERMINAL_EXECUTION_STATUSES.includes(run.status)) {
    throw new RunActionError(`Projet déjà terminé (${run.status})`, 'INVALID_STATE', 409)
  }

  const running = await getRunningRun()
  if (running && running.id !== runId) {
    throw new RunActionError('Un autre projet est déjà en cours — attends sa fin ou arrête-le', 'RUN_ACTIVE', 409)
  }

  const currentStep = run.currentStep ?? 1
  const steps = await getRunSteps(runId)
  const currentRunStep = steps.find((step) => step.stepNumber === currentStep)

  if (!currentRunStep) {
    throw new RunActionError(`Étape ${currentStep} introuvable`, 'STEP_NOT_FOUND', 404)
  }

  const storagePath = join(process.cwd(), 'storage', 'runs', runId)

  if (currentStep === 8) {
    let promptCount = 0
    try {
      const promptData = JSON.parse(await readFile(join(storagePath, 'prompts.json'), 'utf-8')) as { prompts?: unknown[] }
      promptCount = Array.isArray(promptData.prompts) ? promptData.prompts.length : 0
    } catch {
      promptCount = 0
    }

    if (!body.confirmPaidGeneration) {
      throw new RunActionError(
        'Génération payante bloquée : confirmation explicite requise avant de lancer l’étape 8.',
        'PAID_GENERATION_CONFIRMATION_REQUIRED',
        409,
        { expectedSceneCount: promptCount },
      )
    }

    if ((body.confirmationText ?? '').trim() !== PAID_GENERATION_CONFIRMATION_TEXT) {
      throw new RunActionError(
        `Tape exactement "${PAID_GENERATION_CONFIRMATION_TEXT}" pour autoriser la génération payante.`,
        'PAID_GENERATION_TEXT_MISMATCH',
        409,
        { expectedSceneCount: promptCount },
      )
    }

    if ((body.acknowledgedSceneCount ?? -1) !== promptCount) {
      throw new RunActionError(
        `Le nombre de scènes à générer doit être confirmé explicitement (${promptCount}).`,
        'PAID_GENERATION_SCENE_COUNT_MISMATCH',
        409,
        { expectedSceneCount: promptCount },
      )
    }
  }

  if (isLlmBackedStep(currentStep)) {
    const projectConfig = await readProjectConfig(storagePath)
    const existingStepConfig = getStepLlmConfig(projectConfig, currentStep)
    const llmMode = normalizeMeetingLlmMode(body.llmMode ?? existingStepConfig?.mode)
    const requestedLlmModel = typeof body.llmModel === 'string' && body.llmModel.trim()
      ? body.llmModel.trim()
      : existingStepConfig?.model
    const llmModel = normalizeLlmModelForMode(llmMode, requestedLlmModel)

    await writeProjectConfig(storagePath, {
      ...(currentStep === 2 ? { meetingLlmMode: llmMode, meetingLlmModel: llmModel } : {}),
      stepLlmConfigs: {
        [String(currentStep) as '2' | '3' | '4' | '7']: {
          mode: llmMode,
          model: llmModel || '',
        },
      },
    })
  }

  const needsReset = run.status === 'failed' || (run.status === 'paused' && currentRunStep.status === 'completed')

  if (!needsReset && run.status !== 'pending') {
    throw new RunActionError(`Statut projet non lançable : ${run.status}`, 'INVALID_STATE', 409)
  }

  if (needsReset) {
    await resetRunFromStep({
      runId,
      storagePath,
      stepNumber: currentStep,
    })
  }

  executeSingleStep(runId).catch((error) => {
    logger.error({ event: 'manual_step_crash', runId, stepNumber: currentStep, error: (error as Error).message })
  })

  return {
    started: true,
    stepNumber: currentStep,
    rerun: needsReset,
  }
}

export async function approveAndLaunchNextStep(runId: string, body: LaunchCurrentStepInput = {}) {
  const validatedRun = await validateCurrentStep(runId)
  const launch = await launchCurrentStep(runId, body)
  return {
    validatedRun,
    launch,
  }
}
