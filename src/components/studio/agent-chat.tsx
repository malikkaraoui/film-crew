'use client'

import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { SpeakingIndicator } from './speaking-indicator'
import type { MeetingState } from '@/lib/agents/meeting-sequence'

type TraceEntry = {
  id: string
  agentName: string
  messageType: string
  content: { text: string; metadata?: { model?: string; latencyMs?: number; costEur?: number } }
  createdAt: string
}

const AGENT_COLORS: Record<string, string> = {
  mia: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  lenny: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  laura: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  nael: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  emilie: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  nico: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
}

const AGENT_NAMES: Record<string, string> = {
  mia: 'Mia — Cheffe de projet',
  lenny: 'Lenny — Scénariste',
  laura: 'Laura — Cadreuse',
  nael: 'Nael — Metteur en scène',
  emilie: 'Emilie — Habillage',
  nico: 'Nico — Lumière',
}

const TYPE_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  dialogue: { label: 'Dialogue', variant: 'secondary' },
  web_search: { label: 'Recherche web', variant: 'outline' },
  validation: { label: 'Validation', variant: 'default' },
  rejection: { label: 'Rejet', variant: 'destructive' },
  brief_section: { label: 'Brief', variant: 'default' },
}

function formatTraceOffset(from: string, to: string): string {
  const start = new Date(from).getTime()
  const current = new Date(to).getTime()

  if (!Number.isFinite(start) || !Number.isFinite(current) || current < start) {
    return '--:--'
  }

  const totalSeconds = Math.floor((current - start) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `+${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `+${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function AgentChat({
  traces,
  loading,
  meetingState,
}: {
  traces: TraceEntry[]
  loading: boolean
  meetingState?: MeetingState | null
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const firstTraceTime = traces[0]?.createdAt ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [traces.length])

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Chargement de la réunion...</p>
  }

  if (traces.length === 0) {
    return (
      <div className="py-8 text-center space-y-4">
        {meetingState?.nextSpeaker ? (
          <div className="mx-auto max-w-xl rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 text-left dark:border-blue-900/50 dark:bg-blue-950/30">
            <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
              La réunion a démarré, mais la première trace n&apos;est pas encore arrivée.
            </div>
            <div className="mt-1 text-xs text-blue-700 dark:text-blue-300">
              Prochaine prise de parole attendue : {meetingState.nextSpeakerLabel}
            </div>
            <div className="mt-3">
              <SpeakingIndicator
                agent={meetingState.nextSpeaker}
                label={meetingState.nextSpeakerLabel}
                phase={`Phase ${meetingState.phase.number} — ${meetingState.phase.name} · ${meetingState.progress}%`}
              />
            </div>
          </div>
        ) : null}

        <div>
          <p className="text-sm text-muted-foreground">
            Aucune trace de réunion pour ce run.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            La réunion démarre automatiquement à l&apos;étape Brainstorm.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {traces.map((trace) => {
        const colorClass = AGENT_COLORS[trace.agentName] ?? 'bg-gray-100 text-gray-800'
        const agentLabel = AGENT_NAMES[trace.agentName] ?? trace.agentName
        const typeBadge = TYPE_BADGES[trace.messageType]
        const meta = trace.content?.metadata

        return (
          <div key={trace.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                {agentLabel}
              </span>
              {typeBadge && (
                <Badge variant={typeBadge.variant} className="text-[10px]">
                  {typeBadge.label}
                </Badge>
              )}
              <span
                className="ml-auto text-[10px] font-mono text-muted-foreground"
                title={new Date(trace.createdAt).toLocaleString('fr-FR')}
              >
                {firstTraceTime ? formatTraceOffset(firstTraceTime, trace.createdAt) : '--:--'}
              </span>
            </div>

            <p className="text-sm whitespace-pre-wrap">{trace.content?.text}</p>

            {meta && (
              <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground">
                {meta.model && <span>{meta.model}</span>}
                {meta.latencyMs != null && <span>{(meta.latencyMs / 1000).toFixed(1)}s</span>}
                {meta.costEur != null && <span>{meta.costEur.toFixed(3)} €</span>}
              </div>
            )}
          </div>
        )
      })}
      {meetingState?.nextSpeaker && (
        <SpeakingIndicator
          agent={meetingState.nextSpeaker}
          label={meetingState.nextSpeakerLabel}
          phase={`Phase ${meetingState.phase.number} — ${meetingState.phase.name} · ${meetingState.progress}%`}
        />
      )}
      <div ref={bottomRef} />
    </div>
  )
}
