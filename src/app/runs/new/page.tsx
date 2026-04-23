'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { INTENTION_BLOCS, getVisibleQuestions } from '@/lib/intention/schema'
import type { Chain } from '@/types/chain'
import type { MeetingLlmMode } from '@/types/run'

type CostBreakdown = {
  step: string
  provider: string
  costEur: number
  note: string
}

type CostEstimate = {
  totalEur: number
  breakdown: CostBreakdown[]
  warning: string | null
}

type UploadedReferenceImage = {
  url: string
  fileName: string
}

const DEFAULT_LOCAL_MODEL = 'mistral:latest'
const DEFAULT_CLOUD_MODEL = 'deepseek-v3.1:671b-cloud'
const DEFAULT_FULL_VIDEO_DURATION_S = 60
const LOCKED_SCENE_DURATION_S = 10

function NewRunForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [chains, setChains] = useState<Chain[]>([])
  const [chainId, setChainId] = useState('')
  const [idea, setIdea] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')
  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [loadingEstimate, setLoadingEstimate] = useState(true)
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([])
  const [templateId, setTemplateId] = useState('')
  const [meetingMode, setMeetingMode] = useState<MeetingLlmMode>('local')
  const [localModels, setLocalModels] = useState<string[]>([])
  const [cloudModels, setCloudModels] = useState<string[]>([])
  const [localModelsError, setLocalModelsError] = useState('')
  const [meetingLocalModel, setMeetingLocalModel] = useState(DEFAULT_LOCAL_MODEL)
  const [meetingCloudModel, setMeetingCloudModel] = useState(DEFAULT_CLOUD_MODEL)
  const [outputVideoCount, setOutputVideoCount] = useState(1)
  const [fullVideoDurationS, setFullVideoDurationS] = useState(DEFAULT_FULL_VIDEO_DURATION_S)
  const [referenceImageUrl1, setReferenceImageUrl1] = useState('')
  const [referenceImageUrl2, setReferenceImageUrl2] = useState('')
  const [uploadedReferenceImage1, setUploadedReferenceImage1] = useState<UploadedReferenceImage | null>(null)
  const [uploadedReferenceImage2, setUploadedReferenceImage2] = useState<UploadedReferenceImage | null>(null)
  const [uploadingReferenceSlot, setUploadingReferenceSlot] = useState<1 | 2 | null>(null)

  // Questionnaire adaptatif
  const [showQuestionnaire, setShowQuestionnaire] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [openBloc, setOpenBloc] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/chains')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          setChains(json.data)
          const preselect = searchParams?.get('chainId')
          const match = preselect ? (json.data as Chain[]).find((c) => c.id === preselect) : null
          if (match) {
            setChainId(match.id)
          } else if ((json.data as Chain[]).length > 0) {
            setChainId((json.data as Chain[])[0].id)
          }
        }
      })

    fetch('/api/runs/estimate')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setEstimate(json.data)
      })
      .finally(() => setLoadingEstimate(false))

    fetch('/api/templates')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setTemplates(json.data)
      })

    fetch('/api/llm/models')
      .then((r) => r.json())
      .then((json) => {
        const models = Array.isArray(json.data?.localModels) ? json.data.localModels as string[] : []
        const cloud = Array.isArray(json.data?.cloudModels) ? json.data.cloudModels as string[] : []
        setLocalModels(models)
        setCloudModels(cloud)
        if (models.length > 0) {
          setMeetingLocalModel((current) => models.includes(current) ? current : models[0])
        }
        if (cloud.length > 0) {
          setMeetingCloudModel((current) => cloud.includes(current) ? current : cloud[0])
        }
        if (json.data?.localError) setLocalModelsError(json.data.localError)
      })
      .catch(() => {
        setLocalModelsError('Impossible de lister les modèles Ollama locaux')
      })
  }, [searchParams])

  const handleAnswer = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }, [])

  const answeredCount = Object.keys(answers).length
  const visibleQuestions = getVisibleQuestions(answers)
  const selectedMeetingModel = meetingMode === 'cloud'
    ? meetingCloudModel.trim()
    : meetingLocalModel.trim()
  const derivedSceneCount = Math.max(1, Math.ceil(fullVideoDurationS / LOCKED_SCENE_DURATION_S))
  const durationMismatch = fullVideoDurationS % LOCKED_SCENE_DURATION_S !== 0
  const referenceImageUrls = [
    uploadedReferenceImage1?.url || referenceImageUrl1.trim(),
    uploadedReferenceImage2?.url || referenceImageUrl2.trim(),
  ].filter(Boolean)

  async function uploadReferenceImage(slot: 1 | 2, file: File | null) {
    if (!file) return

    setUploadingReferenceSlot(slot)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/reference-images', {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error?.message ?? 'Upload image impossible')
        return
      }

      const uploaded = json.data as UploadedReferenceImage
      if (slot === 1) {
        setUploadedReferenceImage1(uploaded)
        setReferenceImageUrl1('')
      } else {
        setUploadedReferenceImage2(uploaded)
        setReferenceImageUrl2('')
      }
    } catch (uploadError) {
      setError((uploadError as Error).message)
    } finally {
      setUploadingReferenceSlot(null)
    }
  }

  function clearReferenceImage(slot: 1 | 2) {
    if (slot === 1) {
      setUploadedReferenceImage1(null)
      setReferenceImageUrl1('')
      return
    }

    setUploadedReferenceImage2(null)
    setReferenceImageUrl2('')
  }

  async function handleLaunch() {
    if (!chainId || !idea.trim() || durationMismatch) return
    setLaunching(true)
    setError('')

    const body: Record<string, unknown> = {
      chainId,
      idea: idea.trim(),
      template: templateId || undefined,
      autoStart: false,
      meetingLlmMode: meetingMode,
      meetingLlmModel: selectedMeetingModel,
      outputConfig: {
        videoCount: outputVideoCount,
        fullVideoDurationS,
        sceneDurationS: LOCKED_SCENE_DURATION_S,
      },
      referenceImages: {
        urls: referenceImageUrls,
      },
    }

    if (showQuestionnaire && answeredCount > 0) {
      body.intention = answers
    }

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()

    if (json.error) {
      setError(json.error.message)
      setLaunching(false)
      return
    }

    router.push(`/runs/${json.data.id}`)
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold">Nouveau projet</h1>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <Label htmlFor="chain">Chaîne</Label>
          <select
            id="chain"
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            {chains.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="idea">Idée</Label>
          <Input
            id="idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="La polémique Mbappé expliquée en 90 secondes"
          />
        </div>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">Sortie verrouillée</CardTitle>
            <div className="space-y-3 text-sm">
              <div>
                <Label htmlFor="output-video-count">Nombre de vidéos prévues en sortie</Label>
                <Input
                  id="output-video-count"
                  type="number"
                  min={1}
                  step={1}
                  value={outputVideoCount}
                  onChange={(e) => setOutputVideoCount(Math.max(1, Number.parseInt(e.target.value || '1', 10) || 1))}
                />
              </div>

              <div>
                <Label htmlFor="full-video-duration">Vidéo entière à préparer dans ce run (secondes)</Label>
                <Input
                  id="full-video-duration"
                  type="number"
                  min={LOCKED_SCENE_DURATION_S}
                  step={LOCKED_SCENE_DURATION_S}
                  value={fullVideoDurationS}
                  onChange={(e) => setFullVideoDurationS(Math.max(LOCKED_SCENE_DURATION_S, Number.parseInt(e.target.value || `${DEFAULT_FULL_VIDEO_DURATION_S}`, 10) || DEFAULT_FULL_VIDEO_DURATION_S))}
                />
              </div>

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>Durée par scène verrouillée : <strong>{LOCKED_SCENE_DURATION_S}s</strong>.</p>
                <p>Réunion + storyboard + prompts à produire pour la vidéo entière : <strong>{derivedSceneCount} scène(s)</strong>.</p>
                <p>Sortie prévue au global : <strong>{outputVideoCount} vidéo(s)</strong>. Ce run verrouille d’abord la vidéo maîtresse complète.</p>
              </div>

              {durationMismatch && (
                <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  La durée totale doit être un multiple exact de {LOCKED_SCENE_DURATION_S}s.
                </div>
              )}
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">Références visuelles projet</CardTitle>
            <div className="space-y-3 text-sm">
              <div>
                <Label htmlFor="reference-image-url-1">URL image de référence 1</Label>
                <Input
                  id="reference-image-url-1"
                  type="url"
                  value={referenceImageUrl1}
                  onChange={(e) => {
                    setUploadedReferenceImage1(null)
                    setReferenceImageUrl1(e.target.value)
                  }}
                  placeholder="https://.../reference-1.jpg"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null
                      void uploadReferenceImage(1, file)
                      e.currentTarget.value = ''
                    }}
                  />
                  {(uploadedReferenceImage1 || referenceImageUrl1.trim()) && (
                    <Button type="button" variant="outline" onClick={() => clearReferenceImage(1)}>
                      Effacer
                    </Button>
                  )}
                </div>
                {uploadedReferenceImage1 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Fichier uploadé : {uploadedReferenceImage1.fileName}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="reference-image-url-2">URL image de référence 2</Label>
                <Input
                  id="reference-image-url-2"
                  type="url"
                  value={referenceImageUrl2}
                  onChange={(e) => {
                    setUploadedReferenceImage2(null)
                    setReferenceImageUrl2(e.target.value)
                  }}
                  placeholder="https://.../reference-2.jpg"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null
                      void uploadReferenceImage(2, file)
                      e.currentTarget.value = ''
                    }}
                  />
                  {(uploadedReferenceImage2 || referenceImageUrl2.trim()) && (
                    <Button type="button" variant="outline" onClick={() => clearReferenceImage(2)}>
                      Effacer
                    </Button>
                  )}
                </div>
                {uploadedReferenceImage2 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Fichier uploadé : {uploadedReferenceImage2.fileName}
                  </p>
                )}
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>2 références maximum au total, une par slot : URL ou upload PNG/JPG/WEBP.</p>
                <p>Si HappyHorse est utilisé, elles seront envoyées dans <strong>image_urls</strong> avec chaque prompt scène par scène.</p>
                <p>En local `localhost`, elles finiront bien dans la requête, mais HappyHorse ne pourra les récupérer que si ces URLs sont publiquement accessibles.</p>
                <p>Tu peux aussi laisser vide pour rester en texte-vers-vidéo pur.</p>
              </div>
              {uploadingReferenceSlot && (
                <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  Upload image {uploadingReferenceSlot} en cours...
                </div>
              )}
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">Réunion LLM</CardTitle>
            <div className="space-y-3 text-sm">
              <div>
                <Label htmlFor="meeting-mode">Mode</Label>
                <select
                  id="meeting-mode"
                  value={meetingMode}
                  onChange={(e) => setMeetingMode(e.target.value as MeetingLlmMode)}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="local">Local via Ollama (sur ce Mac)</option>
                  <option value="cloud">Cloud via Ollama</option>
                </select>
              </div>

              {meetingMode === 'local' ? (
                <div>
                  <Label htmlFor="meeting-local-model">Modèle local</Label>
                  {localModels.length > 0 ? (
                    <select
                      id="meeting-local-model"
                      value={meetingLocalModel}
                      onChange={(e) => setMeetingLocalModel(e.target.value)}
                      className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      {localModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="meeting-local-model"
                      value={meetingLocalModel}
                      onChange={(e) => setMeetingLocalModel(e.target.value)}
                      placeholder="qwen2.5:7b"
                    />
                  )}
                  {localModelsError && (
                    <p className="mt-1 text-xs text-amber-700">
                      {localModelsError}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <Label htmlFor="meeting-cloud-model">Modèle cloud</Label>
                  {cloudModels.length > 0 ? (
                    <select
                      id="meeting-cloud-model"
                      value={meetingCloudModel}
                      onChange={(e) => setMeetingCloudModel(e.target.value)}
                      className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      {cloudModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="meeting-cloud-model"
                      value={meetingCloudModel}
                      onChange={(e) => setMeetingCloudModel(e.target.value)}
                      placeholder="deepseek-v3.1:671b-cloud"
                    />
                  )}
                  {cloudModels.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cloud dispo : {cloudModels.join(' · ')}
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Rien ne part automatiquement : tu crées d’abord le projet, puis tu lances l’étape 1 manuellement depuis la page projet.
              </p>
            </div>
          </CardHeader>
        </Card>

        {/* Template de style */}
        {templates.length > 0 && (
          <div>
            <Label htmlFor="template">Style</Label>
            <select
              id="template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="">Aucun template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} — {t.description}</option>
              ))}
            </select>
          </div>
        )}

        {/* Questionnaire adaptatif */}
        <div>
          <button
            type="button"
            onClick={() => setShowQuestionnaire((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"
          >
            <span className="flex items-center gap-2">
              <span>Affiner avec le questionnaire</span>
              {answeredCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {answeredCount}/{visibleQuestions.length}
                </Badge>
              )}
            </span>
            <span className="text-muted-foreground">{showQuestionnaire ? '▲' : '▼'}</span>
          </button>

          {showQuestionnaire && (
            <div className="mt-2 space-y-2">
              {INTENTION_BLOCS.map((bloc) => {
                const blocVisible = bloc.questions.filter((q) => {
                  if (!q.showIf) return true
                  return answers[q.showIf.questionId] === q.showIf.value
                })
                const blocAnswered = blocVisible.filter((q) => answers[q.id]).length
                const isOpen = openBloc === bloc.id

                return (
                  <div key={bloc.id} className="rounded-md border border-input overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenBloc(isOpen ? null : bloc.id)}
                      className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{bloc.label}</span>
                        <span className="text-xs text-muted-foreground">{bloc.description}</span>
                        {blocAnswered > 0 && (
                          <Badge variant="default" className="text-[9px]">
                            {blocAnswered}/{blocVisible.length}
                          </Badge>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs">{isOpen ? '▲' : '▼'}</span>
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 space-y-3 bg-muted/20">
                        {blocVisible.map((question) => (
                          <div key={question.id}>
                            <p className="text-xs font-medium mb-1.5 text-muted-foreground">
                              {question.label}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {question.options.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => handleAnswer(question.id, opt.value)}
                                  className={[
                                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                                    answers[question.id] === opt.value
                                      ? 'bg-primary text-primary-foreground border-primary'
                                      : 'border-input hover:bg-accent',
                                  ].join(' ')}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Estimation de coût */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">Coût estimé</CardTitle>
            {loadingEstimate ? (
              <p className="text-xs text-muted-foreground">Calcul en cours...</p>
            ) : estimate ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold">{estimate.totalEur.toFixed(2)} €</span>
                  <span className="text-xs text-muted-foreground">estimation moyenne</span>
                </div>

                <div className="space-y-1">
                  {estimate.breakdown
                    .filter((b) => b.costEur > 0)
                    .map((b) => (
                      <div key={b.step} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{b.step}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">{b.provider}</span>
                          <span className="font-mono">{b.costEur.toFixed(2)} €</span>
                        </span>
                      </div>
                    ))}
                </div>

                {estimate.warning && (
                  <div className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    {estimate.warning}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Estimation indisponible</p>
            )}
          </CardHeader>
        </Card>

        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button onClick={handleLaunch} disabled={launching || !chainId || !idea.trim() || !selectedMeetingModel || durationMismatch}>
          {launching ? 'Création...' : 'Créer le projet'}
        </Button>
      </div>
    </div>
  )
}

export default function NewRunPage() {
  return (
    <Suspense>
      <NewRunForm />
    </Suspense>
  )
}
