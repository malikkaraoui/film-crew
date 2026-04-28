import { getProjectStatusLabel, getRunStepLabel } from '@/lib/runs/presentation'
import { buildValidationChecks, type DashboardAgentTrace, type DashboardCheck, type DashboardCheckTone, type DashboardFailoverEntry } from '@/lib/runs/project-dashboard'
import { formatPipelineStepLabel, getPipelineStepName } from '@/lib/pipeline/constants'
import type { Run, RunStep } from '@/types/run'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function short(value: unknown, max = 180): string {
  const text = readText(value)
  if (!text) return '—'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function extractTraceText(content: unknown): string {
  const record = asRecord(content)
  if (!record) return short(String(content))
  const directText = readText(record.text)
  if (directText) return short(directText)
  const nested = asRecord(record.content)
  const nestedText = readText(nested?.text)
  if (nestedText) return short(nestedText)
  try {
    return short(JSON.stringify(content))
  } catch {
    return short(String(content))
  }
}

function toneRank(tone: DashboardCheckTone): number {
  switch (tone) {
    case 'fail': return 3
    case 'warn': return 2
    case 'pass': return 1
    default: return 0
  }
}

export type BotMeetingVerdict = {
  status: 'missing' | 'pending' | 'pass' | 'warn' | 'fail'
  summary: string
  recommendedAction: 'wait' | 'inspect_manually' | 'approve_and_continue' | 'rerun_meeting'
  checks: DashboardCheck[]
}

export type BotNextAction = {
  kind: 'wait' | 'none' | 'launch_current_step' | 'approve_current_step' | 'approve_and_launch_next_step'
  label: string
  reason: string
  stepNumber: number | null
}

export type BotLiveEvent = {
  at: string | null
  level: 'info' | 'warn' | 'error'
  source: 'trace' | 'failover' | 'step' | 'run'
  title: string
  detail: string
}

export function buildMeetingVerdict(args: {
  brief: Record<string, unknown> | null
  traces: DashboardAgentTrace[]
  step2: RunStep | undefined
}): BotMeetingVerdict {
  const { brief, traces, step2 } = args

  if (!brief && traces.length === 0) {
    return {
      status: 'missing',
      summary: 'Aucune réunion détectée pour ce run.',
      recommendedAction: 'inspect_manually',
      checks: [],
    }
  }

  if (!brief && step2?.status === 'running') {
    return {
      status: 'pending',
      summary: `Réunion en cours — ${traces.length} trace(s) capturée(s) pour l’instant.`,
      recommendedAction: 'wait',
      checks: [],
    }
  }

  const checks = buildValidationChecks({
    stepNumber: 2,
    runStep: step2,
    deliverable: brief,
  })

  const highestTone = checks.reduce<DashboardCheckTone>((current, check) => {
    return toneRank(check.tone) > toneRank(current) ? check.tone : current
  }, 'info')

  if (highestTone === 'fail') {
    return {
      status: 'fail',
      summary: 'La réunion a produit un brief insuffisant ou incohérent pour enchaîner sereinement.',
      recommendedAction: 'rerun_meeting',
      checks,
    }
  }

  if (highestTone === 'warn') {
    return {
      status: 'warn',
      summary: 'La réunion est exploitable, mais quelques signaux faibles méritent une relecture avant validation.',
      recommendedAction: 'inspect_manually',
      checks,
    }
  }

  if (step2?.status === 'running') {
    return {
      status: 'pending',
      summary: 'La réunion tourne encore, mais le brief commence déjà à être lisible.',
      recommendedAction: 'wait',
      checks,
    }
  }

  return {
    status: 'pass',
    summary: 'La réunion a bien abouti : brief exploitable, sections agents présentes et suite débloquable.',
    recommendedAction: 'approve_and_continue',
    checks,
  }
}

export function buildNextAction(args: {
  run: Pick<Run, 'status' | 'currentStep'>
  steps: RunStep[]
}): BotNextAction {
  const { run, steps } = args
  const currentStep = run.currentStep ?? 1
  const currentRunStep = steps.find((step) => step.stepNumber === currentStep)

  if (run.status === 'running') {
    return {
      kind: 'wait',
      label: 'Attendre la fin du step courant',
      reason: `${getRunStepLabel(run)} tourne en ce moment.`,
      stepNumber: currentStep,
    }
  }

  if (run.status === 'pending') {
    return {
      kind: 'launch_current_step',
      label: `Lancer ${getPipelineStepName(currentStep) ?? formatPipelineStepLabel(currentStep)}`,
      reason: 'Le run est prêt : aucune autre validation n’est requise avant le lancement.',
      stepNumber: currentStep,
    }
  }

  if (run.status === 'paused') {
    return {
      kind: currentRunStep?.status === 'completed' ? 'approve_and_launch_next_step' : 'approve_current_step',
      label: 'Valider puis lancer l’étape suivante',
      reason: `${getProjectStatusLabel(run)} — le run attend explicitement ta décision humaine.`,
      stepNumber: currentStep + 1,
    }
  }

  if (run.status === 'failed') {
    return {
      kind: 'launch_current_step',
      label: `Relancer ${getPipelineStepName(currentStep) ?? formatPipelineStepLabel(currentStep)}`,
      reason: 'Le step courant a échoué ; la prochaine action logique est une relance ciblée.',
      stepNumber: currentStep,
    }
  }

  return {
    kind: 'none',
    label: 'Aucune action immédiate',
    reason: getProjectStatusLabel(run),
    stepNumber: null,
  }
}

export function buildLiveEvents(args: {
  run: Pick<Run, 'status' | 'currentStep' | 'updatedAt'>
  steps: RunStep[]
  traces: DashboardAgentTrace[]
  failoverLog: DashboardFailoverEntry[]
  limit?: number
}): BotLiveEvent[] {
  const { run, steps, traces, failoverLog, limit = 12 } = args

  const traceEvents: BotLiveEvent[] = traces.map((trace) => ({
    at: trace.createdAt ? new Date(trace.createdAt).toISOString() : null,
    level: trace.messageType === 'error' ? 'error' : 'info',
    source: 'trace',
    title: `${trace.agentName} · ${trace.messageType}`,
    detail: extractTraceText(trace.content),
  }))

  const failoverEvents: BotLiveEvent[] = failoverLog.map((entry) => ({
    at: entry.timestamp ?? null,
    level: entry.success === false ? 'error' : entry.failoverOccurred ? 'warn' : 'info',
    source: 'failover',
    title: entry.type ? `Failover ${entry.type}` : 'Failover provider',
    detail: entry.failoverOccurred
      ? `${entry.original ?? 'provider'} → ${entry.fallback ?? 'fallback'}${entry.reason ? ` · ${entry.reason}` : ''}`
      : short(entry.error ?? entry.providerUsed ?? entry.reason ?? 'Événement provider'),
  }))

  const stepEvents: BotLiveEvent[] = steps.flatMap((step) => {
    const events: BotLiveEvent[] = []
    if (step.startedAt) {
      events.push({
        at: new Date(step.startedAt).toISOString(),
        level: 'info',
        source: 'step',
        title: `Étape ${step.stepNumber} démarrée`,
        detail: step.stepName,
      })
    }
    if (step.completedAt) {
      events.push({
        at: new Date(step.completedAt).toISOString(),
        level: step.status === 'failed' ? 'error' : 'info',
        source: 'step',
        title: `Étape ${step.stepNumber} ${step.status === 'failed' ? 'échouée' : 'terminée'}`,
        detail: step.error ? short(step.error) : step.stepName,
      })
    }
    return events
  })

  const runEvent: BotLiveEvent[] = run.updatedAt ? [{
    at: new Date(run.updatedAt).toISOString(),
    level: run.status === 'failed' ? 'error' : run.status === 'paused' ? 'warn' : 'info',
    source: 'run',
    title: 'État run',
    detail: `${getProjectStatusLabel(run)}${run.currentStep ? ` · step ${run.currentStep}` : ''}`,
  }] : []

  return [...traceEvents, ...failoverEvents, ...stepEvents, ...runEvent]
    .sort((a, b) => {
      const aTime = a.at ? new Date(a.at).getTime() : 0
      const bTime = b.at ? new Date(b.at).getTime() : 0
      return bTime - aTime
    })
    .slice(0, limit)
}
