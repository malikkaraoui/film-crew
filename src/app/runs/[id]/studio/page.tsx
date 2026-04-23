'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AgentChat } from '@/components/studio/agent-chat'
import { getMeetingState } from '@/lib/agents/meeting-sequence'
import type { MeetingState } from '@/lib/agents/meeting-sequence'
import type { MeetingLlmMode, ProjectConfig, Run, RunStep } from '@/types/run'

type RunWithSteps = Run & { steps: RunStep[]; projectConfig?: ProjectConfig | null }

type TraceEntry = {
  id: string
  agentName: string
  messageType: string
  content: { text: string; metadata?: { model?: string; latencyMs?: number; costEur?: number } }
  createdAt: string
}

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '--:--'

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function StudioPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [traces, setTraces] = useState<TraceEntry[]>([])
  const [run, setRun] = useState<RunWithSteps | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [meetingState, setMeetingState] = useState<MeetingState | null>(null)
  const [meetingStartedAt, setMeetingStartedAt] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [availableLocalModels, setAvailableLocalModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [actionBusy, setActionBusy] = useState<'advance' | 'export' | 'relaunch' | null>(null)
  const [actionNotice, setActionNotice] = useState('')
  const hasMeeting = traces.length > 0
  const meetingDone = traces.length >= 19
  const modelFromTrace = [...traces]
    .reverse()
    .find((trace) => trace.content?.metadata?.model)?.content?.metadata?.model
  const detectedCurrentModel = run?.projectConfig?.meetingLlmModel
    ?? modelFromTrace
    ?? ''
  const firstTraceMs = traces[0]?.createdAt ? new Date(traces[0].createdAt).getTime() : null
  const lastTraceMs = traces.length > 0 ? new Date(traces[traces.length - 1].createdAt).getTime() : null

  const liveDurationMs = useMemo(() => {
    if (meetingDone && firstTraceMs != null && lastTraceMs != null) {
      return Math.max(0, lastTraceMs - firstTraceMs)
    }

    if (firstTraceMs != null) {
      return Math.max(0, nowMs - firstTraceMs)
    }

    if (running && meetingStartedAt) {
      return Math.max(0, nowMs - new Date(meetingStartedAt).getTime())
    }

    return null
  }, [firstTraceMs, lastTraceMs, meetingDone, meetingStartedAt, nowMs, running])

  useEffect(() => {
    void loadRun()
    void loadTraces()
    const interval = setInterval(() => {
      void loadRun()
      void loadTraces()
    }, 3_000)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    if (!(running || (hasMeeting && !meetingDone))) return

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [hasMeeting, meetingDone, running])

  useEffect(() => {
    if (running || (hasMeeting && !meetingDone)) {
      setMeetingState(getMeetingState(traces.length))
    } else {
      setMeetingState(null)
    }
  }, [traces.length, running, hasMeeting, meetingDone])

  useEffect(() => {
    const configuredModel = detectedCurrentModel.trim()
    if (configuredModel && !selectedModel) {
      setSelectedModel(configuredModel)
    }
  }, [detectedCurrentModel, selectedModel])

  useEffect(() => {
    if ((run?.projectConfig?.meetingLlmMode ?? 'local') !== 'local') return

    void loadLocalModels()
  }, [run?.projectConfig?.meetingLlmMode])

  async function loadRun() {
    try {
      const res = await fetch(`/api/runs/${id}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data) setRun(json.data)
    } catch {
      // silencieux côté studio
    }
  }

  async function loadTraces() {
    try {
      const res = await fetch(`/api/runs/${id}/traces`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data) {
        setTraces(json.data)
        if (json.data[0]?.createdAt) {
          setMeetingStartedAt(json.data[0].createdAt)
        }
      }
    } catch { /* silencieux */ }
    setLoading(false)
  }

  async function loadLocalModels() {
    try {
      const res = await fetch('/api/test/ollama-models', { cache: 'no-store' })
      const json = await res.json()
      const models = Array.isArray(json.models) ? json.models : []
      setAvailableLocalModels(models)
      if (!selectedModel && models.length > 0) {
        setSelectedModel(run?.projectConfig?.meetingLlmModel || models[0])
      }
    } catch {
      setAvailableLocalModels([])
    }
  }

  async function startMeeting(force = false) {
    if (hasMeeting && !force) {
      setError("Réunion déjà générée pour ce run — relance bloquée pour éviter les doublons d'agents.")
      return
    }

    setRunning(true)
    setError('')
    setActionNotice('')
    setMeetingStartedAt(new Date().toISOString())
    if (force) {
      setTraces([])
    }

    try {
      const res = await fetch(`/api/runs/${id}/meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force,
          meetingLlmMode: run?.projectConfig?.meetingLlmMode ?? 'local',
          meetingLlmModel: selectedModel.trim() || run?.projectConfig?.meetingLlmModel,
        }),
      })
      const json = await res.json()
      if (json.error) {
        setError(json.error.message)
        await loadRun()
        await loadTraces()
        return
      }
      await loadRun()
      await loadTraces()
    } catch (e) {
      setError((e as Error).message)
      await loadRun()
      await loadTraces()
    } finally {
      setRunning(false)
    }
  }

  async function handleAdvance() {
    if (!run) return

    setActionBusy('advance')
    setActionNotice('')

    try {
      if (run.currentStep === 2 && run.status === 'paused') {
        const res = await fetch(`/api/runs/${id}/validate-step`, { method: 'POST' })
        const json = await res.json()
        if (!res.ok) {
          setActionNotice(json.error?.message ?? 'Passage à l’étape suivante impossible')
          return
        }
        router.push(`/runs/${id}`)
        return
      }

      router.push(`/runs/${id}`)
    } finally {
      setActionBusy(null)
    }
  }

  async function handleExportMeetingJson() {
    setActionBusy('export')
    setActionNotice('')

    try {
      const res = await fetch(`/api/runs/${id}/meeting`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        setActionNotice(json.error?.message ?? 'Export JSON impossible')
        return
      }

      const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `meeting-${id}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setActionNotice((e as Error).message)
    } finally {
      setActionBusy(null)
    }
  }

  async function handleRelaunchWithOtherModel() {
    if (!selectedModel.trim()) {
      setActionNotice('Choisis d’abord un modèle LLM pour relancer la réunion.')
      return
    }

    setActionBusy('relaunch')
    await startMeeting(true)
    setActionBusy(null)
  }

  // Trois états UX distincts
  const isLive = running || (hasMeeting && !meetingDone)
  const isIdle = !hasMeeting && !running
  const canAdvance = meetingDone
  const currentMeetingMode: MeetingLlmMode = run?.projectConfig?.meetingLlmMode ?? 'local'
  const selectedMeetingModel = selectedModel.trim()

  return (
    <div className="flex flex-col gap-4">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Studio Virtuel</h1>
        {isIdle && (
          <Button onClick={() => void startMeeting()} size="sm">
            Lancer la réunion
          </Button>
        )}
      </div>

      {/* Bandeau d'état — sans ambiguïté */}
      {isLive && meetingState && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-950/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Réunion en cours — patiente, les agents parlent tour à tour
              </span>
            </div>
            <span className="text-xs font-mono text-blue-600 dark:text-blue-400">
              {meetingState.completed}/{meetingState.totalExpected}
            </span>
          </div>
          {/* Barre de progression */}
          <div className="mt-2 h-1.5 w-full rounded-full bg-blue-100 dark:bg-blue-900/50">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${meetingState.progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-blue-600 dark:text-blue-400">
            Phase {meetingState.phase.number}/6 — {meetingState.phase.name}
          </p>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
            En attente de : {meetingState.nextSpeakerLabel}
          </p>
          <p className="mt-1 text-xs font-mono text-blue-700 dark:text-blue-300">
            Chrono réunion : {formatDuration(liveDurationMs)}
          </p>
        </div>
      )}

      {meetingDone && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-900/50 dark:bg-green-950/30">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-green-800 dark:text-green-200">
              Réunion terminée — {traces.length} interventions enregistrées
            </span>
            <span className="text-xs font-mono text-green-700 dark:text-green-300">
              Durée totale : {formatDuration(liveDurationMs)}
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <div>{error}</div>
          {traces.length === 0 && (
            <div className="mt-1 text-xs opacity-80">
              Aucune trace n&apos;a été écrite : l&apos;échec est arrivé avant la première réponse d&apos;agent.
            </div>
          )}
        </div>
      )}

      {meetingDone && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleAdvance} disabled={!canAdvance || actionBusy === 'advance'}>
              {actionBusy === 'advance' ? 'Passage...' : 'Passer à l’étape après'}
            </Button>
            <Button variant="outline" onClick={handleExportMeetingJson} disabled={actionBusy === 'export'}>
              {actionBusy === 'export' ? 'Export...' : 'Exporter la réunion en JSON'}
            </Button>
            <Link href={`/runs/${id}`} className="inline-flex">
              <Button variant="outline">Retour au projet</Button>
            </Link>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div>
              <div className="text-sm font-medium">Relancer la réunion avec un autre modèle</div>
              <div className="text-xs text-muted-foreground mt-1">
                Modèle actuel : {detectedCurrentModel ? `${currentMeetingMode} · ${detectedCurrentModel}` : 'non renseigné'}
              </div>
            </div>

            {currentMeetingMode === 'local' ? (
              availableLocalModels.length > 0 ? (
                <select
                  value={selectedMeetingModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {availableLocalModels.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={selectedMeetingModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  placeholder="Nom du modèle Ollama"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                />
              )
            ) : (
              <input
                value={selectedMeetingModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="Nom du modèle cloud"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleRelaunchWithOtherModel} disabled={actionBusy === 'relaunch' || !selectedMeetingModel}>
                {actionBusy === 'relaunch' ? 'Relance...' : 'Relancer la réunion avec un autre modèle LLM'}
              </Button>
            </div>
          </div>

          {actionNotice && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {actionNotice}
            </div>
          )}
        </div>
      )}

      <AgentChat traces={traces} loading={loading} meetingState={isLive ? meetingState : null} />
    </div>
  )
}
