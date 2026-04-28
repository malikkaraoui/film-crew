import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { getRunById, getRunSteps } from '@/lib/db/queries/runs'
import { getAgentTraces } from '@/lib/db/queries/traces'
import { readFailoverLog } from '@/lib/providers/failover'
import { readProjectConfig } from '@/lib/runs/project-config'
import { syncStep2MeetingState } from '@/lib/runs/meeting-sync'
import { getProjectStatusLabel, getRunStepLabel } from '@/lib/runs/presentation'
import { buildLiveEvents, buildMeetingVerdict, buildNextAction } from '@/lib/api/bot-run-control'
import { approveAndLaunchNextStep, launchCurrentStep, RunActionError, validateCurrentStep, type LaunchCurrentStepInput } from '@/lib/runs/manual-actions'

async function readBriefFile(runId: string) {
  try {
    const storagePath = join(process.cwd(), 'storage', 'runs', runId)
    return JSON.parse(await readFile(join(storagePath, 'brief.json'), 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function buildSnapshot(runId: string) {
  await syncStep2MeetingState(runId)
  const run = await getRunById(runId)
  if (!run) return null

  const storagePath = join(process.cwd(), 'storage', 'runs', runId)
  const [steps, traces, failoverLog, brief, projectConfig] = await Promise.all([
    getRunSteps(runId),
    getAgentTraces(runId),
    readFailoverLog(runId),
    readBriefFile(runId),
    readProjectConfig(storagePath),
  ])

  const step2 = steps.find((step) => step.stepNumber === 2)
  const currentStep = run.currentStep ?? 1
  const currentRunStep = steps.find((step) => step.stepNumber === currentStep)
  const completedCount = steps.filter((step) => step.status === 'completed').length
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0
  const meetingVerdict = buildMeetingVerdict({ brief, traces, step2 })
  const nextAction = buildNextAction({ run, steps })
  const liveEvents = buildLiveEvents({ run, steps, traces, failoverLog })

  return {
    run: {
      id: run.id,
      idea: run.idea,
      status: run.status,
      statusLabel: getProjectStatusLabel(run),
      currentStep,
      currentStepLabel: getRunStepLabel(run),
      currentStepStatus: currentRunStep?.status ?? null,
      currentStepError: currentRunStep?.error ?? null,
      costEur: run.costEur ?? 0,
      createdAt: run.createdAt?.toISOString() ?? null,
      updatedAt: run.updatedAt?.toISOString() ?? null,
      projectConfig,
    },
    observation: {
      progressPct,
      completedSteps: completedCount,
      totalSteps: steps.length,
      nextAction,
      liveEvents,
      refreshAfterMs: run.status === 'running' ? 3000 : 0,
    },
    meeting: {
      available: Boolean(brief || traces.length > 0 || step2),
      traceCount: traces.length,
      sectionCount: Array.isArray(brief?.sections) ? brief.sections.length : 0,
      briefSummary: typeof brief?.summary === 'string' ? brief.summary : '',
      verdict: meetingVerdict,
      lastTraces: traces.slice(-6),
    },
    urls: {
      run: `/runs/${run.id}`,
      meeting: `/api/runs/${run.id}/meeting`,
      progress: `/api/runs/${run.id}/progress`,
      traces: `/api/runs/${run.id}/traces`,
      failoverLog: `/api/runs/${run.id}/failover-log`,
    },
  }
}

function asLaunchPayload(body: Record<string, unknown>): LaunchCurrentStepInput {
  return {
    llmMode: body.llmMode as LaunchCurrentStepInput['llmMode'],
    llmModel: typeof body.llmModel === 'string' ? body.llmModel : undefined,
    confirmPaidGeneration: body.confirmPaidGeneration === true,
    confirmationText: typeof body.confirmationText === 'string' ? body.confirmationText : undefined,
    acknowledgedSceneCount: typeof body.acknowledgedSceneCount === 'number' ? body.acknowledgedSceneCount : undefined,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const snapshot = await buildSnapshot(id)

    if (!snapshot) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Run introuvable' } },
        { status: 404 },
      )
    }

    return NextResponse.json({ data: snapshot })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'BOT_CONTROL_GET_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : 'launch_current_step'

    let result: unknown = null
    const launchPayload = asLaunchPayload(body)
    if (action === 'launch_current_step') {
      result = await launchCurrentStep(id, launchPayload)
    } else if (action === 'approve_current_step') {
      result = await validateCurrentStep(id)
    } else if (action === 'approve_and_launch_next_step') {
      result = await approveAndLaunchNextStep(id, launchPayload)
    } else {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: `Action bot inconnue : ${action}` } },
        { status: 400 },
      )
    }

    const snapshot = await buildSnapshot(id)
    return NextResponse.json({ data: { action, result, snapshot } })
  } catch (error) {
    if (error instanceof RunActionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
        { status: error.status },
      )
    }

    return NextResponse.json(
      { error: { code: 'BOT_CONTROL_POST_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
