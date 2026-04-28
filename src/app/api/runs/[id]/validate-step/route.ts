import { NextResponse } from 'next/server'
import { RunActionError, validateCurrentStep } from '@/lib/runs/manual-actions'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const updated = await validateCurrentStep(id)
    return NextResponse.json({ data: updated })
  } catch (error) {
    if (error instanceof RunActionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      )
    }

    return NextResponse.json(
      { error: { code: 'VALIDATE_STEP_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
