import { NextResponse } from 'next/server'
import { launchCurrentStep, RunActionError } from '@/lib/runs/manual-actions'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as {
      llmMode?: 'local' | 'cloud' | 'openrouter'
      llmModel?: string
      confirmPaidGeneration?: boolean
      confirmationText?: string
      acknowledgedSceneCount?: number
    }
    const result = await launchCurrentStep(id, body)
    return NextResponse.json({ data: result })
  } catch (error) {
    if (error instanceof RunActionError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { expectedSceneCount: error.details.expectedSceneCount } : {}),
          },
        },
        { status: error.status },
      )
    }

    return NextResponse.json(
      { error: { code: 'EXECUTE_STEP_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
