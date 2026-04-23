import { readFile } from 'fs/promises'
import { join } from 'path'
import { and, eq } from 'drizzle-orm'
import { FULL_SPEAKING_SEQUENCE } from '@/lib/agents/meeting-sequence'
import { db } from '@/lib/db/connection'
import { getRunById, getRunSteps, updateRunStatus } from '@/lib/db/queries/runs'
import { getAgentTraces } from '@/lib/db/queries/traces'
import { runStep } from '@/lib/db/schema'
import { readProjectConfig } from './project-config'

export const MEETING_EXPECTED_TRACE_COUNT = FULL_SPEAKING_SEQUENCE.length

type SyncStep2MeetingResult = {
  synced: boolean
  reason: 'not_found' | 'step_2_missing' | 'brief_missing' | 'already_synced' | 'synced'
  traceCount: number
  hasBrief: boolean
}

async function readBriefFile(storagePath: string) {
  try {
    return JSON.parse(await readFile(join(storagePath, 'brief.json'), 'utf-8'))
  } catch {
    return null
  }
}

function getMeetingProviderLabel(projectConfig: Awaited<ReturnType<typeof readProjectConfig>>): string | null {
  const parts = [projectConfig?.meetingLlmMode, projectConfig?.meetingLlmModel]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  return parts.length > 0 ? parts.join(' · ') : null
}

export async function syncStep2MeetingState(runId: string): Promise<SyncStep2MeetingResult> {
  const run = await getRunById(runId)
  if (!run) {
    return { synced: false, reason: 'not_found', traceCount: 0, hasBrief: false }
  }

  const storagePath = join(process.cwd(), 'storage', 'runs', runId)
  const [steps, traces, brief, projectConfig] = await Promise.all([
    getRunSteps(runId),
    getAgentTraces(runId),
    readBriefFile(storagePath),
    readProjectConfig(storagePath),
  ])

  const step2 = steps.find((step) => step.stepNumber === 2)
  if (!step2) {
    return { synced: false, reason: 'step_2_missing', traceCount: traces.length, hasBrief: Boolean(brief) }
  }

  if (!brief) {
    return { synced: false, reason: 'brief_missing', traceCount: traces.length, hasBrief: false }
  }

  const firstTraceAt = traces[0]?.createdAt ? new Date(traces[0].createdAt) : null
  const lastTrace = traces[traces.length - 1]
  const lastTraceAt = lastTrace?.createdAt ? new Date(lastTrace.createdAt) : null
  const providerUsed = getMeetingProviderLabel(projectConfig)

  const needsStepUpdate =
    step2.status !== 'completed'
    || step2.outputData == null
    || step2.error != null
    || (providerUsed != null && step2.providerUsed !== providerUsed)

  if (needsStepUpdate) {
    await db
      .update(runStep)
      .set({
        status: 'completed',
        providerUsed: providerUsed ?? step2.providerUsed,
        outputData: brief,
        startedAt: step2.startedAt ?? firstTraceAt ?? new Date(),
        completedAt: step2.completedAt ?? lastTraceAt ?? new Date(),
        error: null,
      })
      .where(and(eq(runStep.runId, runId), eq(runStep.stepNumber, 2)))
  }

  const currentStep = run.currentStep ?? 1
  const shouldPointRunToStep2 = currentStep <= 2 && !['completed', 'killed'].includes(run.status)

  if (shouldPointRunToStep2 && (run.status !== 'paused' || currentStep !== 2)) {
    await updateRunStatus(runId, 'paused', 2)
    return { synced: true, reason: 'synced', traceCount: traces.length, hasBrief: true }
  }

  if (needsStepUpdate) {
    return { synced: true, reason: 'synced', traceCount: traces.length, hasBrief: true }
  }

  return { synced: false, reason: 'already_synced', traceCount: traces.length, hasBrief: true }
}