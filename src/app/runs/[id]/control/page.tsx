'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useLlmCatalog } from '@/lib/client/use-llm-catalog'
import {
  buildModelOptions,
  findModelDetail,
  getModelDetailsForMode,
  getModelsForMode,
  getModelPlaceholder,
} from '@/lib/llm/catalog'
import type { LlmMode, ProjectConfig } from '@/types/run'

type BotLiveEvent = {
  at: string | null
  level: 'info' | 'warn' | 'error'
  source: 'trace' | 'failover' | 'step' | 'run'
  title: string
  detail: string
}

type BotSnapshot = {
  run: {
    id: string
    idea: string
    status: string
    statusLabel: string
    currentStep: number
    currentStepLabel: string
    currentStepStatus: string | null
    currentStepError: string | null
    costEur: number
    createdAt: string | null
    updatedAt: string | null
    projectConfig: ProjectConfig | null
  }
  observation: {
    progressPct: number
    completedSteps: number
    totalSteps: number
    nextAction: {
      kind: 'wait' | 'none' | 'launch_current_step' | 'approve_current_step' | 'approve_and_launch_next_step'
      label: string
      reason: string
      stepNumber: number | null
    }
    liveEvents: BotLiveEvent[]
    refreshAfterMs: number
  }
  meeting: {
    available: boolean
    traceCount: number
    sectionCount: number
    briefSummary: string
    verdict: {
      status: 'missing' | 'pending' | 'pass' | 'warn' | 'fail'
      summary: string
      recommendedAction: 'wait' | 'inspect_manually' | 'approve_and_continue' | 'rerun_meeting'
      checks: Array<{ label: string; detail: string; tone: 'pass' | 'warn' | 'fail' | 'info' }>
    }
    lastTraces: Array<{
      id: string
      agentName: string
      messageType: string
      content: { text?: string; metadata?: { model?: string } }
      createdAt: string
    }>
  }
  urls: {
    run: string
    meeting: string
    progress: string
    traces: string
    failoverLog: string
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('fr-FR')
}

function shortText(value: string | undefined, max = 220): string {
  if (!value) return '—'
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

const verdictMeta = {
  pass: { label: 'Bonne', className: 'bg-green-100 text-green-800 border-green-200' },
  warn: { label: 'Limite', className: 'bg-amber-100 text-amber-900 border-amber-200' },
  fail: { label: 'Ratée', className: 'bg-red-100 text-red-800 border-red-200' },
  pending: { label: 'En cours', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  missing: { label: 'Absente', className: 'bg-slate-100 text-slate-800 border-slate-200' },
} as const

const eventToneClass = {
  info: 'border-slate-200 bg-slate-50 text-slate-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-800',
} as const

export default function RunControlPage() {
  const { id } = useParams<{ id: string }>()
  const [snapshot, setSnapshot] = useState<BotSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [meetingMode, setMeetingMode] = useState<LlmMode>('local')
  const [meetingModel, setMeetingModel] = useState('')
  const [meetingPromptNote, setMeetingPromptNote] = useState('')
  const { catalog, refreshCatalog, refreshingProvider } = useLlmCatalog(meetingMode)

  useEffect(() => {
    void loadSnapshot(true)
  }, [id])

  useEffect(() => {
    if (!snapshot) return
    const delay = snapshot.observation.refreshAfterMs || 5000
    const timer = window.setTimeout(() => {
      void loadSnapshot(false)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [snapshot?.observation.refreshAfterMs, snapshot?.run.updatedAt, id])

  useEffect(() => {
    const config = snapshot?.run.projectConfig
    if (!config) return
    setMeetingMode(config.meetingLlmMode)
    setMeetingModel(config.meetingLlmModel)
    setMeetingPromptNote(config.meetingPromptNote ?? '')
  }, [snapshot?.run.projectConfig?.meetingLlmMode, snapshot?.run.projectConfig?.meetingLlmModel, snapshot?.run.projectConfig?.meetingPromptNote])

  useEffect(() => {
    if (!meetingModel.trim()) {
      const fallback = getModelsForMode(catalog, meetingMode)[0] ?? ''
      if (fallback) setMeetingModel(fallback)
    }
  }, [catalog.cloudModels, catalog.localModels, catalog.openRouterModels, meetingMode, meetingModel])

  async function loadSnapshot(showLoader: boolean) {
    if (showLoader) setLoading(true)
    try {
      const res = await fetch(`/api/bot/runs/${id}/control`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        setNotice(json.error?.message ?? 'Chargement du cockpit impossible')
        return
      }
      setSnapshot(json.data)
    } catch (error) {
      setNotice((error as Error).message)
    } finally {
      if (showLoader) setLoading(false)
    }
  }

  async function callBotAction(action: BotSnapshot['observation']['nextAction']['kind']) {
    if (!snapshot || action === 'wait' || action === 'none') return
    setActionBusy(action)
    setNotice('')
    try {
      const res = await fetch(`/api/bot/runs/${id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) {
        setNotice(json.error?.message ?? 'Action bot impossible')
        return
      }
      setNotice(`Action exécutée : ${action}`)
      if (json.data?.snapshot) setSnapshot(json.data.snapshot)
      await loadSnapshot(false)
    } catch (error) {
      setNotice((error as Error).message)
    } finally {
      setActionBusy(null)
    }
  }

  async function handleKill() {
    if (!window.confirm('Arrêter le run en cours ?')) return
    setActionBusy('kill')
    setNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/kill`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setNotice(json.error?.message ?? 'Arrêt impossible')
        return
      }
      setNotice('Run arrêté.')
      await loadSnapshot(false)
    } catch (error) {
      setNotice((error as Error).message)
    } finally {
      setActionBusy(null)
    }
  }

  async function handleRelaunchMeeting() {
    if (!snapshot) return
    if (snapshot.run.status === 'running' && snapshot.run.currentStep === 2) {
      setNotice('Impossible d’injecter une nouvelle consigne pendant que la réunion tourne. Il faut attendre sa fin ou arrêter le run.')
      return
    }

    if (!meetingModel.trim()) {
      setNotice('Choisis un modèle réunion avant relance.')
      return
    }

    if (!window.confirm('Relancer la réunion en écrasant les traces/brief actuels de l’étape 2 ?')) return

    setActionBusy('meeting-relaunch')
    setNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force: true,
          meetingLlmMode: meetingMode,
          meetingLlmModel: meetingModel.trim(),
          meetingPromptNote,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setNotice(json.error?.message ?? 'Relance réunion impossible')
        return
      }
      setNotice('Réunion relancée avec la nouvelle orientation.')
      await loadSnapshot(false)
    } catch (error) {
      setNotice((error as Error).message)
    } finally {
      setActionBusy(null)
    }
  }

  const verdict = snapshot?.meeting.verdict
  const verdictDisplay = verdict ? verdictMeta[verdict.status] : verdictMeta.missing
  const primaryAction = snapshot?.observation.nextAction
  const meetingRunning = snapshot?.run.status === 'running' && snapshot.run.currentStep === 2
  const meetingInterventionStatus = meetingRunning
    ? 'Non en direct : la réunion est déjà en vol. Je peux surveiller, résumer, puis relancer orienté ensuite.'
    : 'Oui en relance : je peux réorienter la prochaine réunion avec une note d’orientation + changement de modèle.'
  const meetingModelOptions = useMemo(
    () => buildModelOptions(getModelDetailsForMode(catalog, meetingMode), meetingModel),
    [catalog.cloudModels, catalog.localModels, catalog.openRouterModels, meetingMode, meetingModel],
  )
  const selectedMeetingDetail = findModelDetail(catalog, meetingMode, meetingModel)

  if (loading && !snapshot) {
    return <p className="text-sm text-muted-foreground">Chargement du tour de contrôle…</p>
  }

  if (!snapshot) {
    return <p className="text-sm text-destructive">{notice || 'Run introuvable.'}</p>
  }

  const safeVerdict = snapshot.meeting.verdict
  const safePrimaryAction = snapshot.observation.nextAction

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tour de contrôle</h1>
          <p className="text-sm text-muted-foreground">{snapshot.run.idea}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={snapshot.urls.run} className="inline-flex">
            <Button variant="outline">Retour au run</Button>
          </Link>
          <Link href={`/runs/${id}/studio`} className="inline-flex">
            <Button variant="outline">Ouvrir le studio</Button>
          </Link>
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {notice}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>État courant</CardTitle>
              <CardDescription>Le run réel, la prochaine action et les garde-fous opérateur.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{snapshot.run.statusLabel}</Badge>
                <Badge variant="outline">{snapshot.observation.progressPct}%</Badge>
                <Badge variant="outline">{snapshot.observation.completedSteps}/{snapshot.observation.totalSteps} étapes</Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Étape focale</div>
                  <div className="mt-1 text-sm font-medium">{snapshot.run.currentStepLabel}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Statut step</div>
                  <div className="mt-1 text-sm font-medium">{snapshot.run.currentStepStatus ?? '—'}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Créé</div>
                  <div className="mt-1 text-sm font-medium">{formatDate(snapshot.run.createdAt)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Mis à jour</div>
                  <div className="mt-1 text-sm font-medium">{formatDate(snapshot.run.updatedAt)}</div>
                </div>
              </div>

              {snapshot.run.currentStepError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <div className="font-medium">Erreur courante</div>
                  <div className="mt-1 whitespace-pre-wrap">{snapshot.run.currentStepError}</div>
                </div>
              )}

              <Separator />

              <div className="rounded-lg border p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold">Action recommandée</div>
                  <div className="text-sm text-muted-foreground">{safePrimaryAction.label}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {safePrimaryAction.reason}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void callBotAction(safePrimaryAction.kind)}
                    disabled={safePrimaryAction.kind === 'wait' || safePrimaryAction.kind === 'none' || actionBusy === safePrimaryAction.kind}
                  >
                    {actionBusy === safePrimaryAction.kind ? 'Action...' : safePrimaryAction.label}
                  </Button>

                  {snapshot.run.status === 'running' && (
                    <Button variant="destructive" onClick={() => void handleKill()} disabled={actionBusy === 'kill'}>
                      {actionBusy === 'kill' ? 'Arrêt...' : 'Arrêter le run'}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Verdict réunion</CardTitle>
                  <CardDescription>Je peux te dire si elle est bonne, limite ou ratée.</CardDescription>
                </div>
                <Badge variant="outline" className={verdictDisplay.className}>{verdictDisplay.label}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4 text-sm">
                {safeVerdict.summary}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Traces réunion</div>
                  <div className="mt-1 text-sm font-medium">{snapshot.meeting.traceCount}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Sections brief</div>
                  <div className="mt-1 text-sm font-medium">{snapshot.meeting.sectionCount}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Action réunion</div>
                  <div className="mt-1 text-sm font-medium">{safeVerdict.recommendedAction}</div>
                </div>
              </div>

              {snapshot.meeting.briefSummary && (
                <div className="rounded-lg border bg-muted/20 p-4 text-sm whitespace-pre-wrap">
                  {snapshot.meeting.briefSummary}
                </div>
              )}

              {safeVerdict.checks.length > 0 && (
                <div className="grid gap-2 md:grid-cols-2">
                  {safeVerdict.checks.map((check) => (
                    <div key={`${check.label}-${check.detail}`} className={`rounded-lg border p-3 ${eventToneClass[check.tone === 'pass' ? 'info' : check.tone === 'warn' ? 'warn' : check.tone === 'fail' ? 'error' : 'info']}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">{check.label}</div>
                        <span className="text-[11px] font-semibold uppercase tracking-wide">{check.tone}</span>
                      </div>
                      <div className="mt-1 text-sm">{check.detail}</div>
                    </div>
                  ))}
                </div>
              )}

              {snapshot.meeting.lastTraces.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Dernières interventions</div>
                  {snapshot.meeting.lastTraces.map((trace) => (
                    <div key={trace.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{trace.agentName} · {trace.messageType}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(trace.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-foreground/90">{shortText(trace.content?.text)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline live</CardTitle>
              <CardDescription>Ce qui se passe vraiment : traces, failovers, step events, état run.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {snapshot.observation.liveEvents.length === 0 ? (
                <div className="rounded-lg border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                  Aucun événement live pour le moment.
                </div>
              ) : snapshot.observation.liveEvents.map((event, index) => (
                <div key={`${event.source}-${event.at}-${index}`} className={`rounded-lg border p-3 ${eventToneClass[event.level]}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{event.title}</div>
                    <div className="text-xs uppercase tracking-wide">{event.source} · {event.at ? formatDate(event.at) : 'sans date'}</div>
                  </div>
                  <div className="mt-1 text-sm whitespace-pre-wrap">{event.detail}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Intervention réunion</CardTitle>
              <CardDescription>Réponse courte : pas d’injection live en plein vol, mais relance orientée juste après = oui.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {meetingInterventionStatus}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="meeting-mode">Mode réunion</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshCatalog(meetingMode, true)}
                    disabled={meetingRunning || refreshingProvider === meetingMode}
                  >
                    {refreshingProvider === meetingMode ? 'Rafraîchissement...' : 'Rafraîchir'}
                  </Button>
                </div>
                <select
                  id="meeting-mode"
                  value={meetingMode}
                  onChange={(e) => {
                    const nextMode = e.target.value as LlmMode
                    setMeetingMode(nextMode)
                    void refreshCatalog(nextMode)
                  }}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  disabled={meetingRunning}
                >
                  <option value="local">Local</option>
                  <option value="cloud">Cloud</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="meeting-model">Modèle réunion</Label>
                {meetingModelOptions.length > 0 ? (
                  <select
                    id="meeting-model"
                    value={meetingModel}
                    onChange={(e) => setMeetingModel(e.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    disabled={meetingRunning}
                  >
                    {meetingModelOptions.map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="meeting-model"
                    value={meetingModel}
                    onChange={(e) => setMeetingModel(e.target.value)}
                    placeholder={getModelPlaceholder(meetingMode)}
                    disabled={meetingRunning}
                  />
                )}
                {selectedMeetingDetail?.description && (
                  <div className="text-xs text-muted-foreground">{selectedMeetingDetail.description}</div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="meeting-note">Note d’orientation</Label>
                <textarea
                  id="meeting-note"
                  value={meetingPromptNote}
                  onChange={(e) => setMeetingPromptNote(e.target.value)}
                  disabled={meetingRunning}
                  placeholder="Ex: resserre le hook, rends le dialogue plus crédible, pousse un suspense réaliste, évite tout rendu studio."
                  className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>

              <Button onClick={() => void handleRelaunchMeeting()} disabled={meetingRunning || actionBusy === 'meeting-relaunch'} className="w-full">
                {actionBusy === 'meeting-relaunch' ? 'Relance...' : 'Relancer la réunion avec cette orientation'}
              </Button>

              {!catalog.openRouterAvailable && meetingMode === 'openrouter' && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  OpenRouter n’est pas confirmé côté runtime. Vérifie `OPENROUTER_API_KEY`.
                </div>
              )}

              {catalog.openRouterError && meetingMode === 'openrouter' && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {catalog.openRouterError}
                </div>
              )}

              {catalog.localError && meetingMode === 'local' && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {catalog.localError}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Config active</CardTitle>
              <CardDescription>Le run garde sa cohérence de config, pas de mode bricolé à côté.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="font-medium">Réunion</div>
                <div className="mt-1 text-muted-foreground">
                  {snapshot.run.projectConfig?.meetingLlmMode ?? '—'} · {snapshot.run.projectConfig?.meetingLlmModel ?? '—'}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="font-medium">Orientation mémorisée</div>
                <div className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {snapshot.run.projectConfig?.meetingPromptNote || 'Aucune orientation spécifique mémorisée.'}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}