import { NextResponse } from 'next/server'
import { FINAL_PIPELINE_STEP } from '@/lib/pipeline/constants'
import { getRunById, getRunSteps, updateRunStatus } from '@/lib/db/queries/runs'
import { syncStep2MeetingState } from '@/lib/runs/meeting-sync'

export async function POST(
  _request: Request,
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

    const currentStep = run.currentStep ?? 1
    if (run.status !== 'paused') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: 'Ce projet n’attend pas de validation manuelle' } },
        { status: 409 },
      )
    }

    if (currentStep >= FINAL_PIPELINE_STEP) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: 'La dernière étape ne nécessite pas de validation supplémentaire' } },
        { status: 409 },
      )
    }

    const steps = await getRunSteps(id)
    const currentRunStep = steps.find((step) => step.stepNumber === currentStep)

    if (!currentRunStep || currentRunStep.status !== 'completed') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: 'Le livrable courant n’est pas terminé, validation impossible' } },
        { status: 409 },
      )
    }

    const updated = await updateRunStatus(id, 'pending', currentStep + 1)
    return NextResponse.json({ data: updated })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'VALIDATE_STEP_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
