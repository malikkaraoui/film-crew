'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { translatePromptText } from '@/lib/client/prompt-translation'
import type { LlmMode, ProjectConfig, Run, RunStep, StepLlmConfig } from '@/types/run'
import { TOTAL_PIPELINE_STEPS } from '@/lib/pipeline/constants'
import { getRunStepLabel } from '@/lib/runs/presentation'
import {
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
  openRouterModels: string[]
  openRouterAvailable: boolean
}

function getModelsForMode(catalog: LlmCatalog, mode: LlmMode): string[] {
  if (mode === 'cloud') return catalog.cloudModels
  if (mode === 'openrouter') return catalog.openRouterModels
  return catalog.localModels
}

function getModelPlaceholder(mode: LlmMode): string {
  if (mode === 'cloud') return 'deepseek-v3.1:671b-cloud'
  if (mode === 'openrouter') return 'nvidia/nemotron-3-nano-30b-a3b:free'
  return 'qwen2.5:7b'
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

  if (run.status === 'pending' && highestCompleted) return highestCompleted

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function shortText(value: unknown, max = 220): string {
  const text = readText(value)
  if (!text) return '—'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

async function collectPaidGenerationConfirmation(sceneCount: number): Promise<null | {
  confirmPaidGeneration: true
  confirmationText: string
  acknowledgedSceneCount: number
}> {
  const proceed = window.confirm(
    `⚠️ Génération payante réelle. Cette action peut lancer ${sceneCount} scène(s) provider et consommer des crédits. Continuer ?`,
  )
  if (!proceed) return null

  const countInput = window.prompt(`Tape le nombre exact de scènes qui vont partir en génération (${sceneCount})`)?.trim()
  if (!countInput) return null

  const acknowledgedSceneCount = Number.parseInt(countInput, 10)
  if (!Number.isFinite(acknowledgedSceneCount) || acknowledgedSceneCount !== sceneCount) {
    window.alert(`Confirmation invalide : il fallait confirmer exactement ${sceneCount} scène(s).`)
    return null
  }

  const confirmationText = window.prompt('Tape exactement GENERATION PAYANTE pour autoriser le batch payant')?.trim()
  if (confirmationText !== 'GENERATION PAYANTE') {
    window.alert('Confirmation texte invalide. Génération annulée.')
    return null
  }

  return {
    confirmPaidGeneration: true,
    confirmationText,
    acknowledgedSceneCount,
  }
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
  const [catalog, setCatalog] = useState<LlmCatalog>({ localModels: [], localError: null, cloudModels: [], cloudAvailable: false, openRouterModels: [], openRouterAvailable: false })
  const [selectedLlmMode, setSelectedLlmMode] = useState<LlmMode>('local')
  const [selectedLlmModel, setSelectedLlmModel] = useState('')
  const [step6TranslatedPrompts, setStep6TranslatedPrompts] = useState<Record<number, string>>({})
  const [step6Translating, setStep6Translating] = useState<Record<number, 'fr-en' | 'en-fr' | null>>({})
  const [step6TranslationNotice, setStep6TranslationNotice] = useState<Record<number, { tone: 'success' | 'error'; message: string }>>({})
  const focalStep = useMemo(() => (run ? getFocalStep(run) : 1), [run])
  const selectedStep = selectedStepOverride ?? focalStep
  const selectedStepStateToken = useMemo(() => {
    const step = run?.steps.find((entry) => entry.stepNumber === selectedStep)
    if (!step) return `${selectedStep}:missing`
    return [
      step.stepNumber,
      step.status,
      step.startedAt ?? '',
      step.completedAt ?? '',
      step.error ?? '',
    ].join(':')
  }, [run?.steps, selectedStep])

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
  }, [run?.id, selectedStep, selectedStepStateToken])

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
      setCatalog({ localModels: [], localError: 'Catalogue LLM indisponible', cloudModels: [], cloudAvailable: false, openRouterModels: [], openRouterAvailable: false })
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

    let paidGenerationPayload: {
      confirmPaidGeneration: true
      confirmationText: string
      acknowledgedSceneCount: number
    } | null = null

    if (selectedStep === 7) {
      const promptCount = deliverablePrompts.length
      if (promptCount <= 0) {
        setRunNotice('Aucun prompt détecté pour l’étape 7. Génération bloquée.')
        return
      }

      paidGenerationPayload = await collectPaidGenerationConfirmation(promptCount)
      if (!paidGenerationPayload) {
        setRunNotice('Génération payante annulée avant envoi provider.')
        return
      }
    }

    setActionBusy('launch')
    setRunNotice('')
    try {
      const res = await fetch(`/api/runs/${id}/execute-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          {
            ...(isLlmBackedStep(selectedStep)
              ? { llmMode: selectedLlmMode, llmModel: selectedLlmModel.trim() }
              : {}),
            ...(paidGenerationPayload ?? {}),
          },
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

  async function handleTranslateStep6Prompt(promptKey: number, text: string, from: 'fr' | 'en', to: 'fr' | 'en') {
    const source = text.trim()
    if (!source) return

    const key: 'fr-en' | 'en-fr' = from === 'fr' ? 'fr-en' : 'en-fr'
    setStep6Translating((prev) => ({ ...prev, [promptKey]: key }))
    setStep6TranslationNotice((prev) => ({ ...prev, [promptKey]: { tone: 'success', message: '' } }))

    try {
      const result = await translatePromptText(source, { from, to })
      setStep6TranslatedPrompts((prev) => ({ ...prev, [promptKey]: result.text }))
      setStep6TranslationNotice((prev) => ({
        ...prev,
        [promptKey]: {
          tone: 'success',
          message: `${result.provider} · ${result.mode} · ${result.model}`,
        },
      }))
    } catch (error) {
      setStep6TranslationNotice((prev) => ({
        ...prev,
        [promptKey]: {
          tone: 'error',
          message: (error as Error).message,
        },
      }))
    } finally {
      setStep6Translating((prev) => ({ ...prev, [promptKey]: null }))
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
  const deliverableScenes = useMemo(() => asArray(parsedDeliverable?.scenes), [parsedDeliverable])
  const deliverableSections = useMemo(() => asArray(parsedDeliverable?.sections), [parsedDeliverable])
  const deliverablePrompts = useMemo(() => asArray(parsedDeliverable?.prompts), [parsedDeliverable])
  const deliverableClips = useMemo(() => asArray(parsedDeliverable?.clips), [parsedDeliverable])

  const selectedStepLlmConfig = getStepLlmConfig(run?.projectConfig, selectedStep)

  useEffect(() => {
    if (!isLlmBackedStep(selectedStep)) return

    const fallbackMode: LlmMode = selectedStepLlmConfig?.mode ?? (selectedStep === 4 ? 'cloud' : 'local')
    const fallbackModel = selectedStepLlmConfig?.model
      ?? (getModelsForMode(catalog, fallbackMode)[0] ?? '')

    setSelectedLlmMode(fallbackMode)
    setSelectedLlmModel(fallbackModel)
  }, [catalog.cloudModels, catalog.localModels, catalog.openRouterModels, selectedStep, selectedStepLlmConfig?.mode, selectedStepLlmConfig?.model])

  useEffect(() => {
    if (!isLlmBackedStep(selectedStep)) return

    const availableModels = getModelsForMode(catalog, selectedLlmMode)
    if (availableModels.length === 0) return
    if (availableModels.includes(selectedLlmModel)) return

    setSelectedLlmModel(availableModels[0])
  }, [catalog.cloudModels, catalog.localModels, catalog.openRouterModels, selectedLlmMode, selectedLlmModel, selectedStep])

  if (!run) return <p className="text-sm text-muted-foreground">Chargement...</p>

  const currentStep = run.currentStep ?? focalStep
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
  const shouldShowGuidanceMessage = !(run.status === 'failed' && selectedGuidance.tone === 'red')
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
  const isStep2Focus = selectedStep === 2 && currentStep === 2
  const hasMeeting = traces.length > 0
  const meetingCompleted = selectedRunStep?.status === 'completed'
  const isMeetingRunning = isStep2Focus && run.status === 'running'
  const isMeetingInterrupted = isStep2Focus && hasMeeting && !isMeetingRunning && !meetingCompleted
  const showMeetingPanel = isStep2Focus && (isMeetingRunning || hasMeeting)
  const topPanelTone = run.status === 'failed'
    ? 'red'
    : run.status === 'paused' || run.status === 'completed'
      ? 'green'
      : run.status === 'running'
        ? 'blue'
        : 'amber'
  const topPanelClasses = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    green: 'border-green-200 bg-green-50 text-green-900',
    red: 'border-destructive bg-destructive/10 text-destructive',
  }[topPanelTone]

  const topPanelTitle = run.status === 'failed'
    ? `Le projet a échoué à l’étape ${currentStep}.`
    : run.status === 'paused'
      ? `Étape ${currentStep} terminée.`
      : run.status === 'completed'
        ? 'Projet terminé.'
        : run.status === 'running'
          ? `Étape ${currentStep} en cours.`
          : `Projet prêt : l’étape ${currentStep} attend ton lancement manuel.`

  const topPanelBody = run.status === 'failed'
    ? currentRunStep?.error ?? 'Le run a remonté une erreur sans détail supplémentaire.'
    : run.status === 'paused'
      ? 'La validation débloque seulement l’étape suivante : rien ne repart automatiquement.'
      : run.status === 'completed'
        ? `Pipeline terminé sur ${run.steps.filter((s) => s.status === 'completed').length}/${TOTAL_PIPELINE_STEPS} étapes.`
        : run.status === 'running'
          ? `${getRunStepLabel(run)} · ${getStepActionLabel(currentStep)}`
          : 'Le pipeline reste manuel : une étape à la fois, puis validation.'

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
      : selectedStep === 7
        ? 'Étape payante sensible : double confirmation + saisie manuelle obligatoires avant tout appel provider.'
      : 'Le projet exécutera uniquement cette étape, puis se remettra en pause pour validation.'
  } else if (canRelaunchCurrentStep) {
    primaryAction = {
      label: actionBusy === 'launch' ? 'Relance...' : `Relancer l’étape ${selectedStep}`,
      kind: 'button',
      variant: 'default',
      onClick: handleLaunchCurrentStep,
      busy: actionBusy === 'launch',
    }
    actionHint = ''
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

      <div className={`mt-6 rounded-xl border p-4 ${topPanelClasses}`}>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{topPanelTitle}</p>
          <p className="text-sm">{topPanelBody}</p>
        </div>

        {validationChecks.length > 0 && (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {validationChecks.map((check) => (
              <div key={`${check.label}-${check.detail}`} className={`rounded-lg border px-3 py-3 ${CHECK_TONE_CLASSES[check.tone]}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{check.label}</div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide">{check.tone}</span>
                </div>
                <div className="mt-1 text-sm">{check.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className={showMeetingPanel ? '' : 'lg:col-span-2'}>
            <CardHeader>
              <CardTitle>Décision maintenant</CardTitle>
              <CardDescription>{selectedGuidance.title}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {shouldShowGuidanceMessage && (
                <div className={`rounded-md border px-3 py-3 text-sm ${guidanceToneClasses}`}>
                  {selectedGuidance.body}
                </div>
              )}

              {isLlmBackedStep(selectedStep) && isCurrentSelection && (
                <div className="rounded-lg border p-3 space-y-3">
                  <div>
                    <div className="text-sm font-medium">LLM pour l’étape {selectedStep}</div>
                    <div className="text-xs text-muted-foreground">
                      Cloud dispo : {catalog.cloudModels.join(' · ') || 'aucun catalogue cloud reçu'}{catalog.openRouterModels.length > 0 ? ` · OpenRouter : ${catalog.openRouterModels.join(' · ')}` : ''}
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
                        <option value="openrouter">OpenRouter</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="step-llm-model" className="text-xs font-medium text-muted-foreground">Modèle</label>
                      {getModelsForMode(catalog, selectedLlmMode).length > 0 ? (
                        <select
                          id="step-llm-model"
                          value={selectedLlmModel}
                          onChange={(e) => setSelectedLlmModel(e.target.value)}
                          className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                          disabled={run.status === 'running'}
                        >
                          {getModelsForMode(catalog, selectedLlmMode).map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id="step-llm-model"
                          value={selectedLlmModel}
                          onChange={(e) => setSelectedLlmModel(e.target.value)}
                          placeholder={getModelPlaceholder(selectedLlmMode)}
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

                  {!catalog.openRouterAvailable && selectedLlmMode === 'openrouter' && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      OpenRouter n&apos;est pas confirmé côté runtime. Vérifie `OPENROUTER_API_KEY`.
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

          {showMeetingPanel && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Réunion brainstorm</CardTitle>
                    <CardDescription>
                      {isMeetingRunning
                        ? 'La réunion tourne. Ouvre le studio pour la suivre.'
                        : isMeetingInterrupted
                          ? 'La réunion a été interrompue avant sa fin. Pas de validation possible tant qu’elle n’est pas complétée.'
                          : 'La réunion est terminée. Tu peux la revoir, l’exporter ou la supprimer.'}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={isMeetingRunning ? 'secondary' : isMeetingInterrupted ? 'destructive' : 'default'}>
                      {isMeetingRunning ? 'en cours' : isMeetingInterrupted ? 'interrompue' : 'terminée'}
                    </Badge>
                    <Badge variant="outline">{traces.length} trace(s)</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Link href={`/runs/${id}/studio`} className="inline-flex">
                    <Button className="justify-center">
                      {isMeetingRunning
                        ? 'Assister à la réunion'
                        : isMeetingInterrupted
                          ? 'Voir les traces de réunion'
                          : 'Voir la réunion'}
                    </Button>
                  </Link>
                  {meetingCompleted && !isMeetingRunning && (
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
          )}

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{deliverable?.title ?? 'Livrable'}</CardTitle>
                  <CardDescription>
                    {deliverable?.expected ?? STEP_EXPECTATIONS[selectedStep]?.expected}
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

              {loadingDeliverable ? (
                <div className="rounded-lg border bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
                  Chargement du livrable...
                </div>
              ) : !deliverable?.available || !parsedDeliverable ? (
                <div className="rounded-lg border bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
                  {deliverable?.summary || 'Livrable non disponible pour le moment.'}
                </div>
              ) : selectedStep === 2 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4">
                    <div className="text-sm font-semibold">Résumé</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
                      {readText(parsedDeliverable.summary) || 'Aucun résumé visible.'}
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    {deliverableSections.length > 0 ? deliverableSections.map((section, index) => {
                      const record = asRecord(section)
                      return (
                        <div key={`section-${index}`} className="rounded-lg border p-4">
                          <div className="text-sm font-semibold">
                            {readText(record?.title) || readText(record?.agent) || `Section ${index + 1}`}
                          </div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
                            {readText(record?.content) || 'Section vide.'}
                          </div>
                        </div>
                      )
                    }) : (
                      <div className="rounded-lg border px-4 py-8 text-sm text-muted-foreground lg:col-span-2">
                        Aucune section de brief visible.
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedStep === 3 ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border p-4">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Titre</div>
                      <div className="mt-1 text-sm font-medium">{shortText(parsedDeliverable.title, 120)}</div>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Hook</div>
                      <div className="mt-1 text-sm font-medium">{shortText(parsedDeliverable.hook, 120)}</div>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Durée cible</div>
                      <div className="mt-1 text-sm font-medium">{readText(parsedDeliverable.target_duration_s) || '—'}</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {deliverableScenes.length > 0 ? deliverableScenes.map((scene, index) => {
                      const record = asRecord(scene)
                      return (
                        <div key={`scene-${index}`} className="rounded-lg border p-4">
                          <div className="text-sm font-semibold">Scène {index + 1} — {readText(record?.title) || 'Sans titre'}</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
                            {readText(record?.description) || readText(record?.summary) || 'Aucune description visible.'}
                          </div>
                        </div>
                      )
                    }) : (
                      <div className="rounded-lg border px-4 py-8 text-sm text-muted-foreground">
                        Aucune scène visible dans la structure.
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedStep === 4 ? (
                <div className="space-y-3">
                  {deliverableScenes.length > 0 ? deliverableScenes.map((scene, index) => {
                    const record = asRecord(scene)
                    return (
                      <div key={`blueprint-${index}`} className="rounded-lg border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">Plan {index + 1} — {readText(record?.panelTitle) || readText(record?.title) || 'Sans titre'}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {readText(record?.camera) || readText(record?.framing) || readText(record?.sourceCamera) || 'Caméra non renseignée'}
                              {(readText(record?.lighting) || readText(record?.sourceLighting)) ? ` · ${readText(record?.lighting) || readText(record?.sourceLighting)}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">
                          {readText(record?.description) || readText(record?.sourceDescription) || readText(record?.action) || 'Aucune description visible.'}
                        </div>
                        {(readText(record?.childCaption) || readText(record?.dialogue) || readText(record?.action)) && (
                          <div className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-sm">
                            {readText(record?.childCaption) || readText(record?.dialogue) || readText(record?.action)}
                          </div>
                        )}
                      </div>
                    )
                  }) : (
                    <div className="rounded-lg border px-4 py-8 text-sm text-muted-foreground">
                      Aucun panneau blueprint visible.
                    </div>
                  )}
                </div>
              ) : selectedStep === 6 ? (
                <div className="space-y-3">
                  {deliverablePrompts.length > 0 ? deliverablePrompts.map((prompt, index) => {
                    const record = asRecord(prompt)
                    const promptKey = Number(record?.sceneIndex) || index + 1
                    const promptText = step6TranslatedPrompts[promptKey] ?? readText(record?.prompt)
                    const notice = step6TranslationNotice[promptKey]
                    return (
                      <div key={`prompt-${index}`} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold">Prompt {index + 1}</div>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px]"
                              onClick={() => handleTranslateStep6Prompt(promptKey, promptText, 'fr', 'en')}
                              disabled={Boolean(step6Translating[promptKey]) || !promptText.trim()}
                            >
                              {step6Translating[promptKey] === 'fr-en' ? 'Traduction...' : 'FR → EN'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px]"
                              onClick={() => handleTranslateStep6Prompt(promptKey, promptText, 'en', 'fr')}
                              disabled={Boolean(step6Translating[promptKey]) || !promptText.trim()}
                            >
                              {step6Translating[promptKey] === 'en-fr' ? 'Traduction...' : 'EN → FR'}
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
                          {promptText || 'Aucun prompt visible.'}
                        </div>
                        {notice?.message && (
                          <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                            {notice.message}
                          </div>
                        )}
                      </div>
                    )
                  }) : (
                    <pre className="max-h-108 overflow-auto rounded-lg border bg-background p-4 text-xs whitespace-pre-wrap wrap-break-word">
                      {deliverablePreview}
                    </pre>
                  )}
                </div>
              ) : selectedStep === 7 ? (
                <div className="space-y-3">
                  {deliverableClips.length > 0 ? deliverableClips.map((clip, index) => {
                    const record = asRecord(clip)
                    return (
                      <div key={`clip-${index}`} className="rounded-lg border p-4">
                        <div className="text-sm font-semibold">Clip {index + 1}</div>
                        <div className="mt-2 text-sm text-foreground/90">
                          {shortText(record?.prompt || record?.filePath || record?.status, 240)}
                        </div>
                      </div>
                    )
                  }) : (
                    <pre className="max-h-108 overflow-auto rounded-lg border bg-background p-4 text-xs whitespace-pre-wrap wrap-break-word">
                      {deliverablePreview}
                    </pre>
                  )}
                </div>
              ) : (
                <pre className="max-h-108 overflow-auto rounded-lg border bg-background p-4 text-xs whitespace-pre-wrap wrap-break-word">
                  {deliverablePreview}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="xl:sticky xl:top-4">
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
    </div>
  )
}
