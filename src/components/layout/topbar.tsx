'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ThemeToggle } from './theme-toggle'
import { Badge } from '@/components/ui/badge'
import { getMeetingState } from '@/lib/agents/meeting-sequence'
import type { MeetingState } from '@/lib/agents/meeting-sequence'
import { formatPipelineStepLabel } from '@/lib/pipeline/constants'

type ProviderStatus = {
  name: string
  type: string
  health: { status: string; details?: string }
}

type ActiveRun = {
  id: string
  idea: string
  currentStep: number
  costEur: number
  status: string
}

type FailoverEvent = {
  original: string
  fallback: string
  type: string
  reason: string
  timestamp: string
}

const STATUS_COLORS: Record<string, string> = {
  free: 'bg-green-500',
  busy: 'bg-amber-500',
  killing: 'bg-orange-500',
  down: 'bg-red-500',
  degraded: 'bg-amber-600',
}

const STATUS_LABELS: Record<string, string> = {
  free: 'libre',
  busy: 'en cours',
  killing: 'arrêt en cours',
  down: 'hors ligne',
  degraded: 'dégradé',
}

const STATUS_TONES: Record<string, string> = {
  free: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300',
  busy: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
  killing: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300',
  down: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300',
  degraded: 'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-300',
}

const STATUS_RANK: Record<string, number> = {
  down: 0,
  killing: 1,
  busy: 2,
  degraded: 3,
  free: 4,
}

const TYPE_RANK: Record<string, number> = {
  llm: 0,
  video: 1,
  tts: 2,
  image: 3,
  stock: 4,
}

function getStatusRank(status: string): number {
  return STATUS_RANK[status] ?? 99
}

function choosePreferredProvider(current: ProviderStatus, candidate: ProviderStatus): ProviderStatus {
  const currentRank = getStatusRank(current.health.status)
  const candidateRank = getStatusRank(candidate.health.status)

  if (candidateRank < currentRank) return candidate
  if (candidateRank > currentRank) return current
  if (candidate.health.details && !current.health.details) return candidate
  return current
}

function normalizeProviders(entries: ProviderStatus[]): ProviderStatus[] {
  const byName = new Map<string, ProviderStatus>()

  for (const entry of entries) {
    const current = byName.get(entry.name)
    byName.set(entry.name, current ? choosePreferredProvider(current, entry) : entry)
  }

  return [...byName.values()].sort((a, b) => {
    const statusDelta = getStatusRank(a.health.status) - getStatusRank(b.health.status)
    if (statusDelta !== 0) return statusDelta

    const typeDelta = (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99)
    if (typeDelta !== 0) return typeDelta

    return a.name.localeCompare(b.name, 'fr-FR')
  })
}

function upsertProvider(entries: ProviderStatus[], provider: ProviderStatus): ProviderStatus[] {
  return normalizeProviders([
    ...entries.filter((entry) => entry.name !== provider.name),
    provider,
  ])
}

export function Topbar() {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null)
  const [costAlert, setCostAlert] = useState(false)
  const [failovers, setFailovers] = useState<FailoverEvent[]>([])
  const [meeting, setMeeting] = useState<MeetingState | null>(null)

  const loadProviders = async () => {
    try {
      const res = await fetch('/api/providers', { cache: 'no-store' })
      const json = await res.json()
      if (json.data) setProviders(normalizeProviders(json.data as ProviderStatus[]))
    } catch { /* silencieux */ }
  }

  const loadOllamaStatus = async () => {
    try {
      const res = await fetch('/api/providers/ollama', { cache: 'no-store' })
      const json = await res.json()
      if (json.data) {
        setProviders((prev) => upsertProvider(prev, json.data as ProviderStatus))
      }
    } catch { /* silencieux */ }
  }

  const loadActiveRun = async () => {
    try {
      const res = await fetch('/api/queue')
      const json = await res.json()
      if (json.data?.active) {
        setActiveRun(json.data.active)
        const configRes = await fetch('/api/config')
        const configJson = await configRes.json()
        if (configJson.data) {
          const alertCfg = configJson.data.find((c: { key: string }) => c.key === 'cost_alert_per_run')
          if (alertCfg) {
            const threshold = parseFloat(alertCfg.value) * 0.8
            setCostAlert((json.data.active.costEur ?? 0) >= threshold)
          }
        }
      } else {
        setActiveRun(null)
        setCostAlert(false)
      }
    } catch { /* silencieux */ }
  }

  const loadFailovers = async () => {
    try {
      const res = await fetch('/api/providers/failovers')
      const json = await res.json()
      if (json.data) setFailovers(json.data)
    } catch { /* silencieux */ }
  }

  const loadMeetingStatus = async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/traces`)
      const json = await res.json()
      if (json.data) {
        const traceCount = json.data.length
        if (traceCount > 0 && traceCount < 19) {
          setMeeting(getMeetingState(traceCount))
        } else {
          setMeeting(null)
        }
      }
    } catch { setMeeting(null) }
  }

  useEffect(() => {
    void loadProviders()
    void loadOllamaStatus()
    void loadActiveRun()
    void loadFailovers()
    const pi = setInterval(() => void loadProviders(), 60_000)
    const oi = setInterval(() => void loadOllamaStatus(), 1_000)
    const ri = setInterval(() => void loadActiveRun(), 3_000)
    const fi = setInterval(() => void loadFailovers(), 5_000)
    return () => { clearInterval(pi); clearInterval(oi); clearInterval(ri); clearInterval(fi) }
  }, [])

  // Poller le meeting quand un run est actif
  useEffect(() => {
    if (!activeRun?.id || activeRun.status !== 'running') {
      setMeeting(null)
      return
    }
    void loadMeetingStatus(activeRun.id)
    const mi = setInterval(() => void loadMeetingStatus(activeRun.id), 3_000)
    return () => clearInterval(mi)
  }, [activeRun?.id, activeRun?.status])

  async function dismissFailovers() {
    await fetch('/api/providers/failovers', { method: 'DELETE' })
    setFailovers([])
  }

  const providerPills = normalizeProviders(providers)
  const ollama = providerPills.find((p) => p.name === 'ollama')
  const ollamaStatusLabel = ollama ? (STATUS_LABELS[ollama.health.status] ?? ollama.health.status) : null
  const showOllamaBanner = !!ollama && ollama.health.status !== 'free'

  return (
    <header className="sticky top-0 z-50 flex flex-col border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:gap-3">
          <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight">
            FILM-CREW
          </Link>

          {activeRun ? (
            <>
              <Link
                href={`/runs/${activeRun.id}`}
                className="max-w-[24rem] truncate rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium hover:bg-muted/60"
                title={activeRun.idea}
              >
                {activeRun.idea}
              </Link>
              <span className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
                {formatPipelineStepLabel(activeRun.currentStep)}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono ${costAlert
                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'
                : 'border-border/60 bg-muted/30 text-muted-foreground'}`}>
                {(activeRun.costEur ?? 0).toFixed(2)} €
              </span>
            </>
          ) : (
            <span className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
              Aucun run actif
            </span>
          )}

          {meeting && activeRun && (
            <Link
              href={`/runs/${activeRun.id}/studio`}
              className="hidden items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300 md:inline-flex"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              <span>Réunion · phase {meeting.phase.number}/6 · {meeting.progress}%</span>
            </Link>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {activeRun && (
            <Link
              href={`/runs/${activeRun.id}`}
              className="hidden rounded-md border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 md:inline-flex"
            >
              Ouvrir le run
            </Link>
          )}
          <ThemeToggle />
        </div>
      </div>

      {providerPills.length > 0 && (
        <div className="border-t px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Providers
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {providerPills.map((provider) => {
                const statusLabel = STATUS_LABELS[provider.health.status] ?? provider.health.status
                return (
                  <div
                    key={provider.name}
                    className={`shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${STATUS_TONES[provider.health.status] ?? 'border-border/60 bg-muted/30 text-foreground'}`}
                    title={provider.health.details
                      ? `${provider.name} — ${statusLabel} — ${provider.health.details}`
                      : `${provider.name} — ${statusLabel}`}
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[provider.health.status] ?? 'bg-gray-400'}`} />
                    <span className="font-medium">{provider.name}</span>
                    <span className="opacity-70">{statusLabel}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {showOllamaBanner && ollama && (
        <div className="flex items-center justify-between border-t bg-amber-50 px-4 py-1.5 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
              Ollama
            </Badge>
            <span>
              État : {ollamaStatusLabel}
              {ollama.health.details ? ` — ${ollama.health.details}` : ''}
            </span>
          </div>
        </div>
      )}

      {meeting && activeRun && (
        <div className="flex items-center justify-between border-t bg-blue-50 px-4 py-1.5 dark:bg-blue-950/30">
          <div className="flex items-center gap-2 text-xs text-blue-800 dark:text-blue-200">
            <Badge variant="outline" className="border-blue-400 text-blue-700 dark:text-blue-300">
              Réunion
            </Badge>
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            <span>
              {meeting.nextSpeaker
                ? `${meeting.nextSpeakerLabel} réfléchit…`
                : 'Réunion terminée'}
            </span>
            <span className="text-blue-500 dark:text-blue-400">
              — Phase {meeting.phase.number}/6 · {meeting.phase.name} · {meeting.progress}%
            </span>
          </div>
          <Link
            href={`/runs/${activeRun.id}/studio`}
            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 hover:underline"
          >
            Ouvrir le studio
          </Link>
        </div>
      )}

      {failovers.length > 0 && (
        <div className="flex items-center justify-between border-t bg-amber-50 px-4 py-1.5 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
              Failover
            </Badge>
            <span>
              {failovers[0].original} indisponible — basculé sur {failovers[0].fallback}
              {' '}({new Date(failovers[0].timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})
            </span>
            {failovers.length > 1 && (
              <span className="text-amber-600 dark:text-amber-400">
                +{failovers.length - 1} autre{failovers.length > 2 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            onClick={dismissFailovers}
            className="text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
          >
            Fermer
          </button>
        </div>
      )}
    </header>
  )
}
