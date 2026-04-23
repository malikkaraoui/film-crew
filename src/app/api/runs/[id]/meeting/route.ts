import { NextResponse } from 'next/server'
import { MeetingCoordinator } from '@/lib/agents/coordinator'
import { getRunById } from '@/lib/db/queries/runs'
import { getChainById } from '@/lib/db/queries/chains'
import { deleteAgentTraces, getAgentTraces } from '@/lib/db/queries/traces'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { logger } from '@/lib/logger'
import { normalizeLlmModelForMode } from '@/lib/llm/target'
import {
  normalizeMeetingLlmMode,
  readProjectConfig,
  writeProjectConfig,
} from '@/lib/runs/project-config'
import { acquireMeetingLock, MeetingLockError } from '@/lib/runs/meeting-lock'
import { getMeetingState } from '@/lib/agents/meeting-sequence'
import { MEETING_EXPECTED_TRACE_COUNT, syncStep2MeetingState } from '@/lib/runs/meeting-sync'
import { resetRunFromStep } from '@/lib/pipeline/reset'

function getStoragePath(runId: string): string {
  return join(process.cwd(), 'storage', 'runs', runId)
}

async function readBriefFile(storagePath: string) {
  try {
    return JSON.parse(await readFile(join(storagePath, 'brief.json'), 'utf-8'))
  } catch {
    return null
  }
}

function computeDurationMs(traces: Array<{ createdAt: string | Date | null }>): number {
  const datedTraces = traces.filter((trace) => trace.createdAt)
  if (datedTraces.length < 2) return 0

  const first = new Date(datedTraces[0].createdAt as string | Date).getTime()
  const last = new Date(datedTraces[datedTraces.length - 1].createdAt as string | Date).getTime()

  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 0
  return last - first
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const run = await getRunById(id)

    if (!run) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Run introuvable' } },
        { status: 404 },
      )
    }

    await syncStep2MeetingState(id)

    const storagePath = getStoragePath(id)
    const [traces, brief, projectConfig] = await Promise.all([
      getAgentTraces(id),
      readBriefFile(storagePath),
      readProjectConfig(storagePath),
    ])

    const durationMs = computeDurationMs(traces)
    const meetingState = traces.length > 0 && traces.length < MEETING_EXPECTED_TRACE_COUNT
      ? getMeetingState(traces.length)
      : null

    return NextResponse.json({
      data: {
        runId: id,
        idea: run.idea,
        projectConfig,
        traceCount: traces.length,
        durationMs,
        meetingState,
        brief,
        traces,
        exportedAt: new Date().toISOString(),
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'MEETING_GET_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let releaseLock: (() => Promise<void>) | null = null

  try {
    const { id } = await params
    const run = await getRunById(id)
    if (!run) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Run introuvable' } },
        { status: 404 },
      )
    }

    const body = await request.json().catch(() => ({})) as {
      force?: boolean
      meetingLlmMode?: 'local' | 'cloud'
      meetingLlmModel?: string
    }

    if (run.status === 'running' && run.currentStep === 2) {
      return NextResponse.json(
        {
          error: {
            code: 'MEETING_ALREADY_RUNNING',
            message: 'La réunion de l’étape 2 tourne déjà. Attends sa fin ou arrête le run en cours avant toute relance.',
          },
        },
        { status: 409 },
      )
    }

    const storagePath = getStoragePath(id)
    releaseLock = await acquireMeetingLock(id, storagePath)

    const [existingTraces, existingBrief] = await Promise.all([
      getAgentTraces(id),
      readBriefFile(storagePath),
    ])

    if (existingBrief && body.force !== true) {
      await syncStep2MeetingState(id)
      return NextResponse.json(
        {
          error: {
            code: 'MEETING_ALREADY_COMPLETED',
            message: 'La réunion est déjà terminée. Valide l’étape 2 au lieu de la relancer.',
          },
          data: { tracesCount: existingTraces.length },
        },
        { status: 409 },
      )
    }

    if (existingTraces.length > 0 && body.force !== true) {
      return NextResponse.json(
        {
          error: {
            code: 'MEETING_ALREADY_EXISTS',
            message: 'Réunion déjà démarrée pour ce run — relance bloquée pour éviter les doublons d’agents.',
          },
          data: { tracesCount: existingTraces.length },
        },
        { status: 409 },
      )
    }

    if (body.force === true && run.status === 'running') {
      return NextResponse.json(
        {
          error: {
            code: 'RUN_ALREADY_RUNNING',
            message: 'Une étape tourne déjà sur ce projet. Arrête-la avant de forcer une nouvelle réunion.',
          },
        },
        { status: 409 },
      )
    }

    const currentProjectConfig = await readProjectConfig(storagePath)
    const meetingLlmMode = normalizeMeetingLlmMode(body.meetingLlmMode ?? currentProjectConfig?.meetingLlmMode)
    const requestedMeetingLlmModel = typeof body.meetingLlmModel === 'string' && body.meetingLlmModel.trim()
      ? body.meetingLlmModel.trim()
      : currentProjectConfig?.meetingLlmModel
    const meetingLlmModel = normalizeLlmModelForMode(meetingLlmMode, requestedMeetingLlmModel)

    await writeProjectConfig(storagePath, {
      meetingLlmMode,
      meetingLlmModel,
    })

    if (body.force === true && existingTraces.length > 0) {
      await deleteAgentTraces(id)
    }

    // Charger le Brand Kit si disponible
    const chain = run.chainId ? await getChainById(run.chainId) : null
    let brandKit: string | null = null
    if (chain?.brandKitPath) {
      try {
        const brandPath = join(process.cwd(), chain.brandKitPath, 'brand.json')
        brandKit = await readFile(brandPath, 'utf-8')
      } catch {
        logger.warn({ event: 'brand_kit_not_found', chainId: run.chainId })
      }
    }

    const coordinator = new MeetingCoordinator({
      runId: id,
      idea: run.idea,
      brandKit,
      meetingLlmMode,
      meetingLlmModel,
    })

    const brief = await coordinator.runMeeting()

    await writeFile(
      join(storagePath, 'brief.json'),
      JSON.stringify(brief, null, 2),
    )

    await syncStep2MeetingState(id)

    return NextResponse.json({ data: brief })
  } catch (e) {
    if (e instanceof MeetingLockError) {
      return NextResponse.json(
        { error: { code: 'MEETING_ALREADY_RUNNING', message: e.message } },
        { status: 409 },
      )
    }

    logger.error({ event: 'meeting_error', error: (e as Error).message })
    return NextResponse.json(
      { error: { code: 'MEETING_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  } finally {
    await releaseLock?.().catch(() => {})
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const run = await getRunById(id)

    if (!run) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Run introuvable' } },
        { status: 404 },
      )
    }

    if (run.status === 'running' && run.currentStep === 2) {
      return NextResponse.json(
        {
          error: {
            code: 'MEETING_RUNNING',
            message: 'Impossible de supprimer la réunion pendant son exécution.',
          },
        },
        { status: 409 },
      )
    }

    await resetRunFromStep({
      runId: id,
      storagePath: getStoragePath(id),
      stepNumber: 2,
    })

    const updated = await getRunById(id)

    return NextResponse.json({
      data: {
        run: updated,
        message: 'Réunion supprimée. Le run revient à l’étape 2.',
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'MEETING_DELETE_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
