'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AgentChat } from '@/components/studio/agent-chat'
import { FULL_SPEAKING_SEQUENCE, getMeetingState } from '@/lib/agents/meeting-sequence'
import type { MeetingState } from '@/lib/agents/meeting-sequence'
import type { LlmMode, ProjectConfig, Run, RunStep } from '@/types/run'

type RunWithSteps = Run & { steps: RunStep[]; projectConfig?: ProjectConfig | null }

type LlmCatalog = {
  localModels: string[]
  localError: string | null
  cloudModels: string[]
  cloudAvailable: boolean
  openRouterModels: string[]
  openRouterAvailable: boolean
}

function getModelsForMode(catalog: LlmCatalog, mode: LlmMode): string[] {
  if (mode === 'cloud') return catalog.cloudModels
  if (mode === 'openrouter') return catalog.openRouterModels
  return catalog.localModels
}

function getModeLabel(mode: LlmMode): string {
  if (mode === 'cloud') return 'Cloud'
  if (mode === 'openrouter') return 'OpenRouter'
  return 'Local'
}

function getModelPlaceholder(mode: LlmMode): string {
  if (mode === 'cloud') return 'deepseek-v3.1:671b-cloud'
  if (mode === 'openrouter') return 'nvidia/nemotron-3-nano-30b-a3b:free'
  return 'qwen2.5:7b'
}

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
  const [meetingStartedAtMs, setMeetingStartedAtMs] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [catalog, setCatalog] = useState<LlmCatalog>({
    localModels: [],
    localError: null,
    cloudModels: [],
    cloudAvailable: false,
    openRouterModels: [],
    openRouterAvailable: false,
  })
  const [selectedMeetingMode, setSelectedMeetingMode] = useState<LlmMode>('local')
  const [selectedMeetingModel, setSelectedMeetingModel] = useState('')
  const [nextStepMode, setNextStepMode] = useState<LlmMode>('local')
  const [nextStepModel, setNextStepModel] = useState('')
  const [actionBusy, setActionBusy] = useState<'advance' | 'export' | 'relaunch' | null>(null)
  const [actionNotice, setActionNotice] = useState('')
  const hasMeeting = traces.length > 0
  const meetingDone = traces.length >= FULL_SPEAKING_SEQUENCE.length
  const modelFromTrace = [...traces]
    .reverse()
    .find((trace) => trace.content?.metadata?.model)?.content?.metadata?.model
  const step2Config = run?.projectConfig?.stepLlmConfigs?.['2']
    ?? (run?.projectConfig ? { mode: run.projectConfig.meetingLlmMode, model: run.projectConfig.meetingLlmModel } : null)
  const step3Config = run?.projectConfig?.stepLlmConfigs?.['3'] ?? null
  const detectedCurrentModel = step2Config?.model
    ?? modelFromTrace
    ?? ''
  const firstTraceMs = traces[0]?.createdAt ? new Date(traces[0].createdAt).getTime() : null
  const lastTraceMs = traces.length > 0 ? new Date(traces[traces.length - 1].createdAt).getTime() : null
  const step2 = run?.steps.find((step) => step.stepNumber === 2) ?? null
  const meetingCompleted = step2?.status === 'completed' || meetingDone
  const isLive = running || ((run?.status === 'running') && hasMeeting && !meetingCompleted)
  const meetingInterrupted = hasMeeting && !meetingCompleted && run?.status === 'failed'

  const liveDurationMs = useMemo(() => {
    if (meetingDone && firstTraceMs != null && lastTraceMs != null) {
      return Math.max(0, lastTraceMs - firstTraceMs)
    }

    if (firstTraceMs != null) {
      return Math.max(0, nowMs - firstTraceMs)
    }

    if (isLive && meetingStartedAtMs != null) {
      return Math.max(0, nowMs - meetingStartedAtMs)
    }

    return null
  }, [firstTraceMs, isLive, lastTraceMs, meetingDone, meetingStartedAtMs, nowMs])

  useEffect(() => {
    void loadRun()
    void loadTraces()
    void loadLlmCatalog()
    const interval = setInterval(() => {
      void loadRun()
      void loadTraces()
    }, 3_000)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    if (!isLive) return

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [isLive])

  useEffect(() => {
    if (isLive) {
      setMeetingState(getMeetingState(traces.length))
    } else {
      setMeetingState(null)
    }
  }, [traces.length, isLive])

  useEffect(() => {
    const mode = step2Config?.mode ?? 'local'
    const fallbackModel = getModelsForMode(catalog, mode)[0] ?? detectedCurrentModel

    setSelectedMeetingMode(mode)
    setSelectedMeetingModel(step2Config?.model ?? fallbackModel ?? '')
  }, [catalog.cloudModels, catalog.localModels, catalog.openRouterModels, detectedCurrentModel, step2Config?.mode, step2Config?.model])

  useEffect(() => {
    const models = getModelsForMode(catalog, selectedMeetingMode)
    if (models.length === 0) return
    if (models.includes(selectedMeetingModel)) return

    setSelectedMeetingModel(models[0])
  }, [catalog.cloudModels, catalog.localModels, catalog.openRouterModels, selectedMeetingMode, selectedMeetingModel])

  useEffect(() => {
    const mode = step3Config?.mode ?? 'local'
    const fallbackModel = getModelsForMode(catalog, mode)[0] ?? ''

    setNextStepMode(mode)
    setNextStepModel(step3Config?.model ?? fallbackModel)
  }, [catalog.cloudModels, catalog.localModels, catalog.openRouterModels, step3Config?.mode, step3Config?.model])

  useEffect(() => {
    const models = getModelsForMode(catalog, nextStepMode)
    if (models.length === 0) return
    if (models.includes(nextStepModel)) return

    setNextStepModel(models[0])
  }, [catalog.cloudModels, catalog.localModels, catalog.openRouterModels, nextStepMode, nextStepModel])

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
          setMeetingStartedAtMs(new Date(json.data[0].createdAt).getTime())
        }
      }
    } catch { /* silencieux */ }
    setLoading(false)
  }

  async function loadLlmCatalog() {
    try {
      const res = await fetch('/api/llm/models', { cache: 'no-store' })
      const json = await res.json()
      if (json.data) {
        setCatalog(json.data)
      }
    } catch {
      setCatalog({ localModels: [], localError: 'Catalogue LLM indisponible', cloudModels: [], cloudAvailable: false, openRouterModels: [], openRouterAvailable: false })
    }
  }

  async function startMeeting(force = false) {
    const chosenModel = selectedMeetingModel.trim()

    if (meetingCompleted && !force) {
      setError('La réunion est déjà terminée. Valide l’étape 2 au lieu de la relancer.')
      return
    }

    if (hasMeeting && !force) {
      setError("Réunion déjà démarrée pour ce run — relance bloquée pour éviter les doublons d'agents.")
      return
    }

    if (!chosenModel) {
      setError('Choisis un modèle LLM avant de lancer la réunion.')
      return
    }

    setRunning(true)
    setError('')
    setActionNotice('')
    setMeetingStartedAtMs(Date.now())
    if (force) {
      setTraces([])
    }

    try {
      const res = await fetch(`/api/runs/${id}/meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force,
          meetingLlmMode: selectedMeetingMode,
          meetingLlmModel: chosenModel,
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

    const canValidateStep2 = run.currentStep === 2 && run.status === 'paused' && step2?.status === 'completed'
    const chosenNextModel = nextStepModel.trim()

    setActionBusy('advance')
    setActionNotice('')

    try {
      if (canValidateStep2) {
        if (!chosenNextModel) {
          setActionNotice('Choisis le LLM de l’étape 3 avant de passer à la suite.')
          return
        }

        const validateRes = await fetch(`/api/runs/${id}/validate-step`, { method: 'POST' })
        const validateJson = await validateRes.json()
        if (!validateRes.ok) {
          setActionNotice(validateJson.error?.message ?? 'Validation de l’étape 2 impossible')
          return
        }

        const launchRes = await fetch(`/api/runs/${id}/execute-step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ llmMode: nextStepMode, llmModel: chosenNextModel }),
        })
        const launchJson = await launchRes.json()
        if (!launchRes.ok) {
          setActionNotice(launchJson.error?.message ?? 'Lancement de l’étape 3 impossible')
          router.push(`/runs/${id}`)
          return
        }

        router.push(`/runs/${id}`)
        return
      }

      if (run.currentStep === 3 && run.status === 'pending') {
        if (!chosenNextModel) {
          setActionNotice('Choisis le LLM de l’étape 3 avant de lancer la suite.')
          return
        }

        const launchRes = await fetch(`/api/runs/${id}/execute-step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ llmMode: nextStepMode, llmModel: chosenNextModel }),
        })
        const launchJson = await launchRes.json()
        if (!launchRes.ok) {
          setActionNotice(launchJson.error?.message ?? 'Lancement de l’étape 3 impossible')
          return
        }
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
    if (!selectedMeetingModel.trim()) {
      setActionNotice('Choisis d’abord un modèle LLM pour relancer la réunion.')
      return
    }

    setActionBusy('relaunch')
    await startMeeting(true)
    setActionBusy(null)
  }

  const isIdle = !hasMeeting && !running
  const canValidateStep2 = run?.currentStep === 2 && run.status === 'paused' && step2?.status === 'completed'
  const canAdvance = meetingCompleted
  const canLaunchStep3 = (run?.currentStep === 3 && run.status === 'pending') || canValidateStep2
  const advanceLabel = canValidateStep2
    ? 'Valider + lancer l’étape 3'
    : run?.currentStep === 3 && run.status === 'pending'
      ? 'Lancer l’étape 3'
      : 'Retour au cockpit'
  const cloudModelsLabel = catalog.cloudModels.join(' · ')
  const openRouterModelsLabel = catalog.openRouterModels.join(' · ')

  function renderModelPicker(options: {
    mode: LlmMode
    model: string
    onModeChange: (mode: LlmMode) => void
    onModelChange: (model: string) => void
    prefix: string
  }) {
    const models = getModelsForMode(catalog, options.mode)
    const placeholder = getModelPlaceholder(options.mode)

    return (
      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
        <div>
          <label htmlFor={`${options.prefix}-mode`} className="text-xs font-medium text-muted-foreground">Mode</label>
          <select
            id={`${options.prefix}-mode`}
            value={options.mode}
            onChange={(e) => options.onModeChange(e.target.value as LlmMode)}
            className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="local">Local</option>
            <option value="cloud">Cloud</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${options.prefix}-model`} className="text-xs font-medium text-muted-foreground">Modèle</label>
          {models.length > 0 ? (
            <select
              id={`${options.prefix}-model`}
              value={options.model}
              onChange={(e) => options.onModelChange(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          ) : (
            <input
              id={`${options.prefix}-model`}
              value={options.model}
              onChange={(e) => options.onModelChange(e.target.value)}
              placeholder={placeholder}
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
          )}
        </div>
      </div>
    )
  }

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

      {isIdle && (
        <div className="rounded-lg border p-4 space-y-3">
          <div>
            <div className="text-sm font-medium">LLM de la réunion</div>
            <div className="text-xs text-muted-foreground">
                Cloud dispo : {cloudModelsLabel || 'aucun catalogue cloud reçu'}{openRouterModelsLabel ? ` · OpenRouter : ${openRouterModelsLabel}` : ''}
            </div>
          </div>

          {renderModelPicker({
            mode: selectedMeetingMode,
            model: selectedMeetingModel,
            onModeChange: setSelectedMeetingMode,
            onModelChange: setSelectedMeetingModel,
            prefix: 'meeting',
          })}

          {catalog.localError && selectedMeetingMode === 'local' && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {catalog.localError}
            </div>
          )}
        </div>
      )}

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

      {meetingCompleted && (
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

      {meetingInterrupted && (
        <div className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-destructive">
              Réunion interrompue — {traces.length}/{FULL_SPEAKING_SEQUENCE.length} interventions seulement
            </span>
          </div>
          <p className="mt-1 text-xs text-destructive">
            Tu peux consulter les traces, mais pas valider l’étape 2 tant que la réunion n’est pas allée au bout.
          </p>
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

      {meetingCompleted && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {canValidateStep2
              ? 'La réunion est finie. Choisis le LLM de l’étape 3 puis on valide l’étape 2 et on lance la suite.'
              : 'La réunion est finie. Si l’étape 2 est déjà synchronisée, on peut repartir directement sur l’étape 3.'}
          </div>

          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div>
              <div className="text-sm font-medium">Étape 3 — JSON structuré</div>
              <div className="text-xs text-muted-foreground">
                Le modèle choisi ici sera utilisé tout de suite pour la suite.
              </div>
            </div>

            {renderModelPicker({
              mode: nextStepMode,
              model: nextStepModel,
              onModeChange: setNextStepMode,
              onModelChange: setNextStepModel,
              prefix: 'step3',
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleAdvance} disabled={!canAdvance || actionBusy === 'advance'}>
              {actionBusy === 'advance' ? 'Validation...' : advanceLabel}
            </Button>
            <Button variant="outline" onClick={handleExportMeetingJson} disabled={actionBusy === 'export'}>
              {actionBusy === 'export' ? 'Export...' : 'Exporter la réunion en JSON'}
            </Button>
          </div>

          <details className="rounded-lg border bg-muted/20 p-4">
            <summary className="cursor-pointer list-none text-sm font-medium">
              Options avancées — relancer la réunion avec un autre modèle
            </summary>

            <div className="mt-3 space-y-3">
              <div className="text-xs text-muted-foreground">
                Modèle actuel : {detectedCurrentModel ? `${getModeLabel(selectedMeetingMode)} · ${detectedCurrentModel}` : 'non renseigné'}
              </div>

              {renderModelPicker({
                mode: selectedMeetingMode,
                model: selectedMeetingModel,
                onModeChange: setSelectedMeetingMode,
                onModelChange: setSelectedMeetingModel,
                prefix: 'meeting-relaunch',
              })}

              <Button variant="outline" onClick={handleRelaunchWithOtherModel} disabled={actionBusy === 'relaunch' || !selectedMeetingModel}>
                {actionBusy === 'relaunch' ? 'Relance...' : 'Relancer la réunion avec ce modèle'}
              </Button>
            </div>
          </details>

          {!catalog.cloudAvailable && nextStepMode === 'cloud' && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Le cloud LLM n&apos;est pas confirmé côté runtime. Vérifie la config Ollama cloud si besoin.
            </div>
          )}

          {!catalog.openRouterAvailable && (selectedMeetingMode === 'openrouter' || nextStepMode === 'openrouter') && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              OpenRouter n&apos;est pas confirmé côté runtime. Vérifie `OPENROUTER_API_KEY` avant lancement.
            </div>
          )}

          {!canLaunchStep3 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              La réunion est finie. Retour cockpit uniquement, pas de double bouton inutile.
            </div>
          )}

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
