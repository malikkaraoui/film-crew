import { NextResponse } from 'next/server'
import { join } from 'path'
import { getRunById, getRunSteps, getRunningRun } from '@/lib/db/queries/runs'
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

const TERMINAL_STATUSES = ['completed', 'killed']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    await syncStep2MeetingState(id)
    const run = await getRunById(id)

    if (!run) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Projet introuvable' } },
        { status: 404 },
      )
    }

    if (run.status === 'running') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: 'Une étape est déjà en cours sur ce projet' } },
        { status: 409 },
      )
    }

    if (TERMINAL_STATUSES.includes(run.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: `Projet déjà terminé (${run.status})` } },
        { status: 409 },
      )
    }

    const running = await getRunningRun()
    if (running && running.id !== id) {
      return NextResponse.json(
        { error: { code: 'RUN_ACTIVE', message: 'Un autre projet est déjà en cours — attends sa fin ou arrête-le' } },
        { status: 409 },
      )
    }

    const currentStep = run.currentStep ?? 1
    const steps = await getRunSteps(id)
    const currentRunStep = steps.find((step) => step.stepNumber === currentStep)
    const body = await request.json().catch(() => ({})) as {
      llmMode?: 'local' | 'cloud'
      llmModel?: string
    }

    if (!currentRunStep) {
      return NextResponse.json(
        { error: { code: 'STEP_NOT_FOUND', message: `Étape ${currentStep} introuvable` } },
        { status: 404 },
      )
    }

    const storagePath = join(process.cwd(), 'storage', 'runs', id)

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
          [String(currentStep) as '2' | '3' | '4' | '6']: {
            mode: llmMode,
            model: llmModel || '',
          },
        },
      })
    }

    const needsReset = run.status === 'failed' || (run.status === 'paused' && currentRunStep.status === 'completed')

    if (!needsReset && run.status !== 'pending') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: `Statut projet non lançable : ${run.status}` } },
        { status: 409 },
      )
    }

    if (needsReset) {
      await resetRunFromStep({
        runId: id,
        storagePath,
        stepNumber: currentStep,
      })
    }

    executeSingleStep(id).catch((error) => {
      logger.error({ event: 'manual_step_crash', runId: id, stepNumber: currentStep, error: (error as Error).message })
    })

    return NextResponse.json({
      data: {
        started: true,
        stepNumber: currentStep,
        rerun: needsReset,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'EXECUTE_STEP_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
