'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { LlmMode, ProjectConfig, Run, RunStep, StepLlmConfig } from '@/types/run'
import { TOTAL_PIPELINE_STEPS } from '@/lib/pipeline/constants'
import { getProjectStatusClass, getProjectStatusLabel, getRunStepLabel } from '@/lib/runs/presentation'
import {
  buildContextSections,
  buildValidationChecks,
  formatRelativeTime,
  formatStepDuration,
  parseDeliverableContent,
  summarizeTechnicalLog,
  type DashboardAgentTrace,
  type DashboardCheckTone,
  type DashboardFailoverEntry,
} from '@/lib/runs/project-dashboard'

type RunWithSteps = Run & { steps: RunStep[]; projectConfig?: ProjectConfig | null }

type Deliverable = {
  stepNumber: number
  title: string
  expected: string
  editable: boolean
  pageHref: string | null
  fileName: string | null
  available: boolean
  content: string | null
  summary: string
}

type PrimaryAction = {
  label: string
  kind: 'button' | 'link'
  variant?: 'default' | 'outline' | 'destructive'
  onClick?: () => void
  href?: string
  busy?: boolean
}

type LlmCatalog = {
  localModels: string[]
  localError: string | null
  cloudModels: string[]
  cloudAvailable: boolean
}

const STEP_EXPECTATIONS: Record<number, { label: string; expected: string }> = {
  1: { label: 'Idée', expected: 'intention.json — idée enrichie et cadrée' },
  2: { label: 'Brainstorm', expected: 'brief.json — réunion et sections agents' },
  3: { label: 'JSON structuré', expected: 'structure.json — structure canonique du film' },
  4: { label: 'Blueprint visuel', expected: 'storyboard-blueprint.json — plan visuel simple scène par scène' },
  5: { label: 'Storyboard', expected: 'manifest storyboard + rough local + planche de vignettes' },
  6: { label: 'Prompts', expected: 'prompt-manifest.json — prompts vidéo + négatifs' },
  7: { label: 'Génération', expected: 'generation-manifest.json — clips/audio générés' },
  8: { label: 'Preview', expected: 'preview-manifest.json + brouillon playable si dispo' },
  9: { label: 'Publication', expected: 'publish-manifest.json + contexte export' },
}

const STEP_ACTIONS: Record<number, string> = {
  1: 'Cadrer l’idée de départ',
  2: 'Lancer la réunion brainstorm',
  3: 'Générer la structure JSON du film',
  4: 'Fabriquer le blueprint visuel scène par scène',
  5: 'Générer le storyboard rough scène par scène',
  6: 'Préparer les prompts vidéo',
  7: 'Lancer la génération des clips',
  8: 'Assembler et relire la preview',
  9: 'Préparer la publication finale',
}

const STEP_VIEW_LABELS: Record<number, string> = {
  2: 'Ouvrir le studio brainstorm',
  5: 'Ouvrir le storyboard',
  6: 'Ouvrir les prompts',
  7: 'Ouvrir la génération',
  8: 'Ouvrir la preview',
  9: 'Ouvrir la publication',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'à venir',
  running: 'en cours',
  paused: 'à valider',
  completed: 'terminée',
  failed: 'échouée',
  killed: 'arrêtée',
}

const CHECK_TONE_CLASSES: Record<DashboardCheckTone, string> = {
  pass: 'border-green-200 bg-green-50 text-green-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  fail: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
}

const CHECK_BADGE_VARIANT: Record<DashboardCheckTone, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pass: 'default',
  warn: 'secondary',
  fail: 'destructive',
  info: 'outline',
}

function getStepActionLabel(stepNumber: number): string {
  return STEP_ACTIONS[stepNumber] ?? 'Exécuter cette étape'
}

function getStepViewLabel(stepNumber: number): string {
  return STEP_VIEW_LABELS[stepNumber] ?? `Ouvrir l’étape ${stepNumber}`
}

function getStepGuidance(params: {
  stepNumber: number
  stepStatus: string
  currentStep: number
  runStatus: string
}): { tone: 'amber' | 'blue' | 'green' | 'red'; title: string; body: string } {
  const { stepNumber, stepStatus, currentStep, runStatus } = params
  const action = getStepActionLabel(stepNumber)
  const currentLabel = STEP_EXPECTATIONS[currentStep]?.label ?? `Étape ${currentStep}`
  const previousLabel = STEP_EXPECTATIONS[Math.max(1, stepNumber - 1)]?.label ?? `Étape ${Math.max(1, stepNumber - 1)}`
  const nextAction = stepNumber < TOTAL_PIPELINE_STEPS ? getStepActionLabel(stepNumber + 1) : null

  if (stepNumber === currentStep) {
    if (runStatus === 'running') {
      return {
        tone: 'blue',
        title: 'Étape en cours maintenant',
        body: `Le projet exécute actuellement : ${action}. Rien ne partira plus loin automatiquement ensuite.`,
      }
    }

    if (runStatus === 'paused' && stepStatus === 'completed') {
      return {
        tone: 'green',
        title: 'Étape terminée — validation requise',
        body: nextAction
          ? `Relis ce livrable puis décide : valider cette étape pour simplement débloquer la suite (${nextAction}). Rien ne se lancera automatiquement.`
          : 'La dernière étape est terminée. Il ne reste plus de passage suivant à débloquer.',
      }
    }

    if (runStatus === 'failed' || stepStatus === 'failed') {
      return {
        tone: 'red',
        title: 'Étape en erreur',
        body: `Cette étape a échoué pendant : ${action}. Corrige le blocage puis relance uniquement cette étape.`,
      }
    }

    if (runStatus === 'pending') {
      return {
        tone: 'amber',
        title: 'Étape prête à être lancée',
        body: `Action attendue ici : ${action}. Une fois terminée, le projet s’arrêtera en attente de ta validation.`,
      }
    }

    if (runStatus === 'completed') {
      return {
        tone: 'green',
        title: 'Projet terminé',
        body: 'Le pipeline est arrivé au bout. Tu peux relire les livrables ou repartir d’une étape précédente si besoin.',
      }
    }

    if (runStatus === 'killed') {
      return {
        tone: 'red',
        title: 'Projet arrêté',
        body: 'Le projet a été stoppé. Tu peux repartir depuis une étape déjà terminée si tu veux reprendre proprement.',
      }
    }
  }

  if (stepStatus === 'completed') {
    return {
      tone: 'green',
      title: 'Étape déjà produite',
      body: 'Ce livrable existe déjà. Tu peux le consulter ou repartir depuis ici si tu veux réouvrir le tunnel à partir de cette étape.',
    }
  }

  if (stepStatus === 'running') {
    return {
      tone: 'blue',
      title: 'Étape actuellement en cours',
      body: 'Cette étape tourne en ce moment. Attends sa fin avant toute autre décision.',
    }
  }

  return {
    tone: 'amber',
    title: 'Étape verrouillée',
    body: `Tu ne peux pas lancer cette étape tout de suite. Il faut d’abord terminer et valider : ${previousLabel}. Étape focalisée actuelle : ${currentLabel}.`,
  }
}

function getFocalStep(run: RunWithSteps): number {
  const highestCompleted = [...run.steps]
    .filter((step) => step.status === 'completed')
    .sort((a, b) => b.stepNumber - a.stepNumber)[0]?.stepNumber

  if (run.status === 'completed') return highestCompleted ?? run.currentStep ?? 1

  if (run.currentStep && run.currentStep > 0) return run.currentStep

  return highestCompleted ?? 1
}

function isLlmBackedStep(stepNumber: number): boolean {
  return [2, 3, 4, 6].includes(stepNumber)
}

function getStepLlmConfig(config: ProjectConfig | null | undefined, stepNumber: number): StepLlmConfig | null {
  const key = String(stepNumber) as '2' | '3' | '4' | '6'
  if (![2, 3, 4, 6].includes(stepNumber)) return null

  if (config?.stepLlmConfigs?.[key]) return config.stepLlmConfigs[key] ?? null
  if (stepNumber === 2 && config) {
    return { mode: config.meetingLlmMode, model: config.meetingLlmModel }
  }

  return null
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>()
  const [run, setRun] = useState<RunWithSteps | null>(null)
  const [selectedStepOverride, setSelectedStepOverride] = useState<number | null>(null)
  const [deliverable, setDeliverable] = useState<Deliverable | null>(null)
  const [draft, setDraft] = useState('')
  const [loadingDeliverable, setLoadingDeliverable] = useState(false)
  const [savingDeliverable, setSavingDeliverable] = useState(false)
  const [deliverableNotice, setDeliverableNotice] = useState('')
  const [runNotice, setRunNotice] = useState('')
  const [actionBusy, setActionBusy] = useState<'launch' | 'validate' | 'rewind' | 'kill' | 'export-meeting' | 'delete-meeting' | null>(null)
  const [traces, setTraces] = useState<DashboardAgentTrace[]>([])
  const [failoverLog, setFailoverLog] = useState<DashboardFailoverEntry[]>([])
  const [catalog, setCatalog] = useState<LlmCatalog>({ localModels: [], localError: null, cloudModels: [], cloudAvailable: false })
  const [selectedLlmMode, setSelectedLlmMode] = useState<LlmMode>('local')
  const [selectedLlmModel, setSelectedLlmModel] = useState('')
  const focalStep = useMemo(() => (run ? getFocalStep(run) : 1), [run])
  const selectedStep = selectedStepOverride ?? focalStep

  useEffect(() => {
    void loadRun()
    void loadLlmCatalog()
    const interval = setInterval(() => {
      void loadRun()
    }, 3000)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    setSelectedStepOverride(null)
  }, [run?.id])

  useEffect(() => {
    if (!run) return
    void loadDeliverable(selectedStep)
  }, [run?.id, selectedStep])

  useEffect(() => {
    if (!run) return

    const needsTraces = selectedStep === 2 || run.currentStep === 2
    const needsFailoverLog = selectedStep >= 5 || run.status === 'failed' || failoverLog.length > 0

    if (needsTraces) void loadTraces()
    if (needsFailoverLog) void loadFailoverLog()

    if (!needsTraces && !needsFailoverLog) return

    const interval = window.setInterval(() => {
      if (needsTraces) void loadTraces()
      if (needsFailoverLog) void loadFailoverLog()
    }, 5000)

    return () => window.clearInterval(interval)
  }, [run?.id, run?.status, run?.currentStep, selectedStep, failoverLog.length])

  async function loadRun() {
    const res = await fetch(`/api/runs/${id}`)
    const json = await res.json()
    if (json.data) setRun(json.data)
  }

  async function loadLlmCatalog() {
    try {
      const res = await fetch('/api/llm/models', { cache: 'no-store' })
      const json = await res.json()
      if (json.data) setCatalog(json.data)
    } catch {
      setCatalog({ localModels: [], localError: 'Catalogue LLM indisponible', cloudModels: [], cloudAvailable: false })
    }
  }

  async function loadTraces() {
    const res = await fetch(`/api/runs/${id}/traces`, { cache: 'no-store' })
    const json = await res.json()
    if (json.data) setTraces(json.data)
  }

  async function loadFailoverLog() {
    const res = await fetch(`/api/runs/${id}/failover-log`, { cache: 'no-store' })
    const json = await res.json()
    if (json.data) setFailoverLog(json.data)
  }

  async function loadDeliverable(stepNumber: number) {
    setLoadingDeliverable(true)
    setDeliverableNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/deliverables/${stepNumber}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data) {
        setDeliverable(json.data)
        setDraft(json.data.content ?? '')
      }
    } catch (e) {
      setDeliverableNotice((e as Error).message)
    } finally {
      setLoadingDeliverable(false)
    }
  }

  async function saveDeliverable() {
    if (!deliverable?.editable) return
    setSavingDeliverable(true)
    setDeliverableNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/deliverables/${selectedStep}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      const json = await res.json()
      if (!res.ok) {
        setDeliverableNotice(json.error?.message ?? 'Sauvegarde impossible')
        return
      }
      setDeliverableNotice('Livrable sauvegardé')
      await loadDeliverable(selectedStep)
    } catch (e) {
      setDeliverableNotice((e as Error).message)
    } finally {
      setSavingDeliverable(false)
    }
  }

  async function handleLaunchCurrentStep() {
    if (!run) return
    if (isLlmBackedStep(selectedStep) && !selectedLlmModel.trim()) {
      setRunNotice('Choisis un modèle LLM avant de lancer cette étape.')
      return
    }

    const needsConfirmation = run.status === 'paused' || run.status === 'failed'
    if (needsConfirmation && !confirm(`Relancer l'étape ${selectedStep} ? Les livrables aval seront remis à zéro.`)) return

    setActionBusy('launch')
    setRunNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/execute-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isLlmBackedStep(selectedStep)
            ? { llmMode: selectedLlmMode, llmModel: selectedLlmModel.trim() }
            : {},
        ),
      })
      const json = await res.json()
      if (!res.ok) {
        setRunNotice(json.error?.message ?? 'Lancement impossible')
        return
      }
      setRunNotice(`Étape ${json.data.stepNumber} lancée.`)
      await loadRun()
      await loadDeliverable(selectedStep)
    } finally {
      setActionBusy(null)
    }
  }

  async function handleValidateCurrentStep() {
    setActionBusy('validate')
    setRunNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/validate-step`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setRunNotice(json.error?.message ?? 'Validation impossible')
        return
      }
      setRunNotice(`Étape ${selectedStep} validée. La suite est débloquée.`)
      await loadRun()
    } finally {
      setActionBusy(null)
    }
  }

  async function handleRewindToSelectedStep() {
    if (!confirm(`Repartir depuis l'étape ${selectedStep} ? Les livrables des étapes suivantes seront remis à zéro.`)) return

    setActionBusy('rewind')
    setRunNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/step-back`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStep: selectedStep }),
      })
      const json = await res.json()
      if (!res.ok) {
        setRunNotice(json.error?.message ?? 'Retour impossible')
        return
      }
      setRunNotice(`Le projet est repositionné sur l'étape ${selectedStep}.`)
      await loadRun()
      await loadDeliverable(selectedStep)
    } finally {
      setActionBusy(null)
    }
  }

  async function handleKill() {
    if (!confirm('Arrêter l’étape en cours ?')) return

    setActionBusy('kill')
    setRunNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/kill`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setRunNotice(json.error?.message ?? 'Arrêt impossible')
        return
      }
      setRunNotice('Projet arrêté.')
      await loadRun()
    } finally {
      setActionBusy(null)
    }
  }

  async function handleExportMeetingJson() {
    setActionBusy('export-meeting')
    setRunNotice('')

    try {
      const res = await fetch(`/api/runs/${id}/meeting`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        setRunNotice(json.error?.message ?? 'Export JSON impossible')
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
      setRunNotice('Réunion exportée en JSON.')
    } finally {
      setActionBusy(null)
    }
  }

  async function handleDeleteMeeting() {
    if (!confirm('Supprimer la réunion et remettre le run à l’étape 2 ?')) return

    setActionBusy('delete-meeting')
    setRunNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/meeting`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) {
        setRunNotice(json.error?.message ?? 'Suppression impossible')
        return
      }
      setRunNotice(json.data?.message ?? 'Réunion supprimée.')
      setTraces([])
      await loadRun()
      await loadDeliverable(2)
    } finally {
      setActionBusy(null)
    }
  }

  const deliverablePreview = useMemo(() => {
    if (!deliverable?.content) return ''
    try {
      return JSON.stringify(JSON.parse(deliverable.content), null, 2)
    } catch {
      return deliverable.content
    }
  }, [deliverable?.content])

  const parsedDeliverable = useMemo(
    () => parseDeliverableContent(deliverable?.content),
    [deliverable?.content],
  )

  const selectedStepLlmConfig = getStepLlmConfig(run?.projectConfig, selectedStep)

  useEffect(() => {
    if (!isLlmBackedStep(selectedStep)) return

    const fallbackMode: LlmMode = selectedStepLlmConfig?.mode ?? (selectedStep === 4 ? 'cloud' : 'local')
    const fallbackModel = selectedStepLlmConfig?.model
      ?? (fallbackMode === 'cloud' ? catalog.cloudModels[0] ?? '' : catalog.localModels[0] ?? '')

    setSelectedLlmMode(fallbackMode)
    setSelectedLlmModel(fallbackModel)
  }, [catalog.cloudModels, catalog.localModels, selectedStep, selectedStepLlmConfig?.mode, selectedStepLlmConfig?.model])

  if (!run) return <p className="text-sm text-muted-foreground">Chargement...</p>

  const currentStep = run.currentStep ?? focalStep
  const completedSteps = run.steps.filter((step) => step.status === 'completed').length
  const currentStepInfo = STEP_EXPECTATIONS[selectedStep]
  const selectedRunStep = run.steps.find((step) => step.stepNumber === selectedStep)
  const currentRunStep = run.steps.find((step) => step.stepNumber === currentStep)
  const selectedStatus = selectedRunStep?.status ?? 'pending'
  const selectedGuidance = getStepGuidance({
    stepNumber: selectedStep,
    stepStatus: selectedStatus,
    currentStep,
    runStatus: run.status,
  })
  const guidanceToneClasses = {
    amber: 'border-amber-300 bg-amber-50 text-amber-900',
    blue: 'border-blue-300 bg-blue-50 text-blue-900',
    green: 'border-green-300 bg-green-50 text-green-900',
    red: 'border-destructive bg-destructive/10 text-destructive',
  }[selectedGuidance.tone]
  const isCurrentSelection = selectedStep === currentStep
  const canLaunchCurrentStep = isCurrentSelection && run.status === 'pending'
  const canValidateCurrentStep = isCurrentSelection && run.status === 'paused' && selectedRunStep?.status === 'completed' && currentStep < TOTAL_PIPELINE_STEPS
  const canRelaunchCurrentStep = isCurrentSelection
    && (run.status === 'paused' || run.status === 'failed')
    && !(selectedStep === 2 && selectedRunStep?.status === 'completed')
  const canRewindToSelectedStep = selectedStep < currentStep && selectedRunStep?.status === 'completed' && run.status !== 'running'
  const nextStepNumber = selectedStep < TOTAL_PIPELINE_STEPS ? selectedStep + 1 : null
  const validationChecks = buildValidationChecks({
    stepNumber: selectedStep,
    runStep: selectedRunStep,
    deliverable: parsedDeliverable,
  })
  const contextSections = buildContextSections({
    stepNumber: selectedStep,
    deliverable: parsedDeliverable,
    runStep: selectedRunStep,
    traces,
  })
  const latestCompletedStep = [...run.steps]
    .filter((step) => step.completedAt)
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime())[0] ?? null
  const isStep2Focus = selectedStep === 2 && currentStep === 2
  const hasMeeting = traces.length > 0
  const isMeetingRunning = isStep2Focus && run.status === 'running'
  const showMeetingPanel = isStep2Focus && (isMeetingRunning || hasMeeting)

  let primaryAction: PrimaryAction | null = null
  let secondaryAction: PrimaryAction | null = null
  let actionHint = ''
  if (run.status === 'running') {
    primaryAction = {
      label: actionBusy === 'kill' ? 'Arrêt en cours...' : 'Arrêter l’étape en cours',
      kind: 'button',
      variant: 'destructive',
      onClick: handleKill,
      busy: actionBusy === 'kill',
    }
    if (isCurrentSelection && deliverable?.pageHref) {
      secondaryAction = {
        label: getStepViewLabel(selectedStep),
        kind: 'link',
        variant: 'outline',
        href: deliverable.pageHref,
      }
    }
    actionHint = 'Aucune étape suivante ne partira automatiquement pendant que celle-ci tourne.'
  } else if (canValidateCurrentStep) {
    primaryAction = {
      label: actionBusy === 'validate' ? 'Validation...' : `Valider l’étape ${selectedStep}`,
      kind: 'button',
      variant: 'default',
      onClick: handleValidateCurrentStep,
      busy: actionBusy === 'validate',
    }
    actionHint = nextStepNumber
      ? `La validation ne lance rien : elle débloque seulement l’étape ${nextStepNumber}.`
      : 'La validation clôt proprement la dernière étape.'
    if (deliverable?.pageHref) {
      secondaryAction = {
        label: getStepViewLabel(selectedStep),
        kind: 'link',
        variant: 'outline',
        href: deliverable.pageHref,
      }
    }
  } else if (canLaunchCurrentStep) {
    primaryAction = {
      label: actionBusy === 'launch' ? `Lancement de l’étape ${selectedStep}...` : `Lancer l’étape ${selectedStep}`,
      kind: 'button',
      variant: 'default',
      onClick: handleLaunchCurrentStep,
      busy: actionBusy === 'launch',
    }
    actionHint = isLlmBackedStep(selectedStep)
      ? `LLM prévu : ${selectedLlmMode} · ${selectedLlmModel || 'à choisir'}. Le projet exécutera uniquement cette étape.`
      : 'Le projet exécutera uniquement cette étape, puis se remettra en pause pour validation.'
  } else if (canRelaunchCurrentStep) {
    primaryAction = {
      label: actionBusy === 'launch' ? 'Relance...' : `Relancer l’étape ${selectedStep}`,
      kind: 'button',
      variant: 'default',
      onClick: handleLaunchCurrentStep,
      busy: actionBusy === 'launch',
    }
    actionHint = isLlmBackedStep(selectedStep)
      ? `LLM prévu : ${selectedLlmMode} · ${selectedLlmModel || 'à choisir'}. Cette relance réécrasera les livrables aval.`
      : 'Cette relance réécrasera les livrables aval déjà produits à partir de cette étape.'
  } else if (canRewindToSelectedStep) {
    primaryAction = {
      label: actionBusy === 'rewind' ? 'Repositionnement...' : 'Repartir depuis cette étape',
      kind: 'button',
      variant: 'outline',
      onClick: handleRewindToSelectedStep,
      busy: actionBusy === 'rewind',
    }
    actionHint = 'Le tunnel sera rouvert à partir de cette étape et les suivantes seront remises à zéro.'
  } else if (deliverable?.pageHref) {
    primaryAction = {
      label: getStepViewLabel(selectedStep),
      kind: 'link',
      variant: 'outline',
      href: deliverable.pageHref,
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold truncate max-w-md">{run.idea}</h1>
      </div>

      {run.status === 'pending' && (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-700">
            Projet prêt : l’étape {currentStep} attend ton lancement manuel.
          </p>
        </div>
      )}
      {run.status === 'paused' && (
        <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-700">
            Étape {currentStep} terminée. La validation débloque seulement l’étape suivante : rien ne repart automatiquement.
          </p>
        </div>
      )}
      {run.status === 'failed' && (
        <div className="mt-6 rounded-md border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">
            Le projet a échoué à l&apos;étape {currentStep}.
            {run.steps.find(s => s.stepNumber === currentStep)?.error && (
              <span className="block mt-1 font-mono text-xs">{run.steps.find(s => s.stepNumber === currentStep)?.error}</span>
            )}
          </p>
        </div>
      )}
      {run.status === 'completed' && (
        <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-700">
            Projet terminé — {run.steps.filter(s => s.status === 'completed').length}/{TOTAL_PIPELINE_STEPS} étapes complétées.
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="grid gap-4 lg:grid-cols-2">
          {!isStep2Focus && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Cockpit projet</CardTitle>
                <CardDescription>
                  Vue rapide pour savoir où tu en es et ce qui se passe réellement maintenant.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border px-3 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Statut</div>
                  <div className={`mt-1 text-sm font-semibold ${getProjectStatusClass(run.status)}`}>
                    {getProjectStatusLabel(run)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{completedSteps}/{TOTAL_PIPELINE_STEPS} étapes terminées</div>
                </div>

                <div className="rounded-lg border px-3 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Étape active</div>
                  <div className="mt-1 text-sm font-semibold">{getRunStepLabel(run)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{getStepActionLabel(currentStep)}</div>
                </div>

                <div className="rounded-lg border px-3 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Santé runtime</div>
                  <div className="mt-1 text-sm font-semibold">
                    Heartbeat {run.lastHeartbeat ? formatRelativeTime(run.lastHeartbeat) : '—'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Durée étape : {formatStepDuration(currentRunStep)}
                  </div>
                </div>

                <div className="rounded-lg border px-3 py-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">LLM étape inspectée</div>
                  <div className="mt-1 text-sm font-semibold">
                    {isLlmBackedStep(selectedStep) && selectedStepLlmConfig
                      ? `${selectedStepLlmConfig.mode} · ${selectedStepLlmConfig.model}`
                      : 'Aucun LLM sur cette étape'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Coût run : {(run.costEur ?? 0).toFixed(2)} €
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Décision maintenant</CardTitle>
              <CardDescription>{selectedGuidance.title}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`rounded-md border px-3 py-3 text-sm ${guidanceToneClasses}`}>
                {selectedGuidance.body}
              </div>

              {isLlmBackedStep(selectedStep) && isCurrentSelection && (
                <div className="rounded-lg border p-3 space-y-3">
                  <div>
                    <div className="text-sm font-medium">LLM pour l’étape {selectedStep}</div>
                    <div className="text-xs text-muted-foreground">
                      Cloud dispo : {catalog.cloudModels.join(' · ') || 'aucun catalogue cloud reçu'}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                    <div>
                      <label htmlFor="step-llm-mode" className="text-xs font-medium text-muted-foreground">Mode</label>
                      <select
                        id="step-llm-mode"
                        value={selectedLlmMode}
                        onChange={(e) => setSelectedLlmMode(e.target.value as LlmMode)}
                        className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                        disabled={run.status === 'running'}
                      >
                        <option value="local">Local</option>
                        <option value="cloud">Cloud</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="step-llm-model" className="text-xs font-medium text-muted-foreground">Modèle</label>
                      {(selectedLlmMode === 'cloud' ? catalog.cloudModels : catalog.localModels).length > 0 ? (
                        <select
                          id="step-llm-model"
                          value={selectedLlmModel}
                          onChange={(e) => setSelectedLlmModel(e.target.value)}
                          className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                          disabled={run.status === 'running'}
                        >
                          {(selectedLlmMode === 'cloud' ? catalog.cloudModels : catalog.localModels).map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id="step-llm-model"
                          value={selectedLlmModel}
                          onChange={(e) => setSelectedLlmModel(e.target.value)}
                          placeholder={selectedLlmMode === 'cloud' ? 'deepseek-v3.1:671b-cloud' : 'qwen2.5:7b'}
                          className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                          disabled={run.status === 'running'}
                        />
                      )}
                    </div>
                  </div>

                  {catalog.localError && selectedLlmMode === 'local' && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {catalog.localError}
                    </div>
                  )}
                </div>
              )}

              {primaryAction && (
                primaryAction.kind === 'link' && primaryAction.href ? (
                  <Link href={primaryAction.href} className="inline-flex w-full">
                    <Button variant={primaryAction.variant ?? 'default'} className="w-full justify-center">
                      {primaryAction.label}
                    </Button>
                  </Link>
                ) : (
                  <Button
                    variant={primaryAction.variant ?? 'default'}
                    className="w-full justify-center"
                    onClick={primaryAction.onClick}
                    disabled={primaryAction.busy}
                  >
                    {primaryAction.label}
                  </Button>
                )
              )}

              {actionHint && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {actionHint}
                </div>
              )}

              {secondaryAction && (
                secondaryAction.kind === 'link' && secondaryAction.href ? (
                  <Link href={secondaryAction.href} className="inline-flex w-full">
                    <Button variant={secondaryAction.variant ?? 'outline'} className="w-full justify-center">
                      {secondaryAction.label}
                    </Button>
                  </Link>
                ) : (
                  <Button
                    variant={secondaryAction.variant ?? 'outline'}
                    className="w-full justify-center"
                    onClick={secondaryAction.onClick}
                    disabled={secondaryAction.busy}
                  >
                    {secondaryAction.label}
                  </Button>
                )
              )}

              {runNotice && (
                <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  {runNotice}
                </div>
              )}
            </CardContent>
          </Card>

          {!isStep2Focus && (
            <Card>
              <CardHeader>
                <CardTitle>Repères utiles</CardTitle>
                <CardDescription>Contexte minimal pour ne pas te perdre entre deux validations.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">Étape inspectée</span>
                  <span className="font-medium">{selectedStep}/{TOTAL_PIPELINE_STEPS}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">Dernière étape finie</span>
                  <span className="font-medium">
                    {latestCompletedStep ? `Étape ${latestCompletedStep.stepNumber}` : 'Aucune'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">Fin dernière activité</span>
                  <span className="font-medium">
                    {latestCompletedStep?.completedAt ? formatRelativeTime(latestCompletedStep.completedAt) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">Traces réunion</span>
                  <span className="font-medium">{traces.length}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Validation avant passage</CardTitle>
              <CardDescription>
                Preuves concrètes pour décider si l’étape {selectedStep} mérite validation ou relance.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {validationChecks.length === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  Pas encore de critères calculés pour cette étape.
                </div>
              ) : validationChecks.map((check) => (
                <div key={`${check.label}-${check.detail}`} className={`rounded-lg border px-3 py-3 ${CHECK_TONE_CLASSES[check.tone]}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium">{check.label}</div>
                    <Badge variant={CHECK_BADGE_VARIANT[check.tone]}>{check.tone}</Badge>
                  </div>
                  <div className="mt-2 text-sm">{check.detail}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tunnel {TOTAL_PIPELINE_STEPS} étapes</CardTitle>
            <CardDescription>
              Tu peux inspecter n’importe quel livrable, sans perdre la main sur le projet actif.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {run.steps.map((step) => {
              const meta = STEP_EXPECTATIONS[step.stepNumber]
              const isSelected = step.stepNumber === selectedStep
              const isCurrent = step.stepNumber === currentStep
              return (
                <button
                  key={step.id}
                  type="button"
                    onClick={() => setSelectedStepOverride(step.stepNumber)}
                  className={`w-full rounded-lg border p-3 text-left transition ${isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Étape {step.stepNumber} — {meta?.label ?? step.stepName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{meta?.expected ?? step.stepName}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground/80">
                        <span>Action : {getStepActionLabel(step.stepNumber)}</span>
                        {isCurrent && <span>· étape focale</span>}
                      </div>
                    </div>
                    <Badge variant={step.status === 'completed' ? 'default' : step.status === 'running' ? 'secondary' : step.status === 'failed' ? 'destructive' : 'outline'}>
                      {STATUS_LABELS[step.status] ?? step.status}
                    </Badge>
                  </div>
                </button>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {isStep2Focus ? (
          showMeetingPanel ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Réunion brainstorm</CardTitle>
                    <CardDescription>
                      {isMeetingRunning
                        ? 'La réunion tourne. Ouvre le studio pour la suivre.'
                        : 'La réunion existe déjà. Tu peux juste la revoir, l’exporter ou la supprimer.'}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={isMeetingRunning ? 'secondary' : 'default'}>
                      {isMeetingRunning ? 'en cours' : 'terminée'}
                    </Badge>
                    <Badge variant="outline">{traces.length} trace(s)</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Link href={`/runs/${id}/studio`} className="inline-flex">
                    <Button className="justify-center">
                      {isMeetingRunning ? 'Assister à la réunion' : 'Voir la réunion'}
                    </Button>
                  </Link>
                  {!isMeetingRunning && (
                    <>
                      <Button
                        variant="outline"
                        onClick={handleExportMeetingJson}
                        disabled={actionBusy === 'export-meeting'}
                      >
                        {actionBusy === 'export-meeting' ? 'Export...' : 'Exporter en JSON'}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleDeleteMeeting}
                        disabled={actionBusy === 'delete-meeting'}
                      >
                        {actionBusy === 'delete-meeting' ? 'Suppression...' : 'Supprimer la réunion'}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>
                    Vue contextuelle — Étape {selectedStep} · {currentStepInfo?.label ?? selectedRunStep?.stepName}
                  </CardTitle>
                  <CardDescription>
                    {deliverable?.expected ?? currentStepInfo?.expected}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={selectedRunStep?.status === 'completed' ? 'default' : selectedRunStep?.status === 'running' ? 'secondary' : selectedRunStep?.status === 'failed' ? 'destructive' : 'outline'}>
                    {STATUS_LABELS[selectedStatus] ?? selectedStatus}
                  </Badge>
                  {deliverable?.fileName && <Badge variant="outline">{deliverable.fileName}</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingDeliverable ? (
                <div className="rounded-md border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                  Chargement du livrable...
                </div>
              ) : contextSections.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  Aucune vue contextuelle disponible pour cette étape.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {contextSections.map((section) => (
                    <div key={section.title} className="rounded-lg border p-4">
                      <div className="text-sm font-semibold">{section.title}</div>
                      {section.description && (
                        <div className="mt-1 text-xs text-muted-foreground">{section.description}</div>
                      )}
                      {section.body && (
                        <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-sm">{section.body}</div>
                      )}
                      {section.items && section.items.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {section.items.map((item) => (
                            <div key={`${section.title}-${item.label}-${item.value}`} className={`rounded-md border px-3 py-2 text-sm ${item.tone ? CHECK_TONE_CLASSES[item.tone] : 'border-border bg-background text-foreground'}`}>
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</div>
                              <div className="mt-1">{item.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Inspecter le livrable</CardTitle>
            <CardDescription>
              Une seule entrée utile pour l’étape choisie, puis les détails avancés si tu veux creuser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {deliverable?.pageHref && (
              <Link href={deliverable.pageHref} className="inline-flex w-full">
                <Button variant="outline" className="w-full justify-center">{getStepViewLabel(selectedStep)}</Button>
              </Link>
            )}

            {deliverableNotice && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {deliverableNotice}
              </div>
            )}

            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer list-none text-sm font-semibold">
                Source brute / édition avancée
              </summary>
              <div className="mt-4 space-y-3">
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  {deliverable?.summary ?? 'Aucun livrable disponible pour cette étape.'}
                </div>

                {deliverable?.editable ? (
                  <div className="space-y-3">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div>
                        {selectedStatus === 'running'
                          ? `Cette étape est en cours. Si le contenu est encore vide, c’est normal : ${getStepActionLabel(selectedStep)} remplit ce livrable automatiquement.`
                          : 'Édition clavier active pour les utilisateurs avancés.'}
                      </div>
                      <div>
                        Raccourci : <span className="font-mono">⌘/Ctrl + S</span> pour sauvegarder.
                      </div>
                    </div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                          e.preventDefault()
                          void saveDeliverable()
                        }
                      }}
                      placeholder={selectedStatus === 'running'
                        ? `Étape en cours : ${getStepActionLabel(selectedStep)}. Le contenu apparaîtra ici dès que le système aura fini.`
                        : `Contenu éditable de l’étape ${selectedStep}.`}
                      className="min-h-96 w-full rounded-md border bg-background p-3 font-mono text-xs"
                    />
                    <div className="flex justify-end">
                      <Button onClick={saveDeliverable} disabled={savingDeliverable}>
                        {savingDeliverable ? 'Sauvegarde...' : 'Sauvegarder'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <pre className="max-h-108 overflow-auto rounded-md border bg-background p-3 text-xs whitespace-pre-wrap wrap-break-word">
                    {deliverablePreview || 'Aucun contenu texte à afficher ici. Utilise la vue dédiée pour consulter le livrable.'}
                  </pre>
                )}
              </div>
            </details>

            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer list-none text-sm font-semibold">
                Détails techniques
              </summary>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="text-sm font-medium">Étape sélectionnée</div>
                  <div className="space-y-2 text-sm">
                    <div className="rounded-md border px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Provider</div>
                      <div className="mt-1">{selectedRunStep?.providerUsed ?? '—'}</div>
                    </div>
                    <div className="rounded-md border px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Durée</div>
                      <div className="mt-1">{formatStepDuration(selectedRunStep)}</div>
                    </div>
                    <div className="rounded-md border px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Erreur</div>
                      <div className="mt-1 wrap-break-word">{selectedRunStep?.error ?? 'Aucune'}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium">Logs failover / providers</div>
                  {failoverLog.length === 0 ? (
                    <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                      Aucun log technique remonté pour ce projet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {failoverLog.slice(0, 8).map((entry, index) => {
                        const summary = summarizeTechnicalLog(entry)
                        return (
                          <div key={`${summary.title}-${index}`} className="rounded-md border px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium">{summary.title}</div>
                              <div className="text-xs text-muted-foreground">{formatRelativeTime(entry.timestamp ?? null)}</div>
                            </div>
                            <div className="mt-1 text-muted-foreground">{summary.detail}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
