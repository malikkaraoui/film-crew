'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type ProviderEntry = {
  name: string
  excludedFromStandard: boolean
  health: {
    status: 'free' | 'busy' | 'killing' | 'down' | 'degraded'
    details?: string
  }
}

type SettingOption = {
  key: string
  available: string[]
  selected: string
}

type RequestEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt: string
  negativePromptSent: boolean
  chosenSettings: {
    resolution: '720p' | '1080p' | '480p'
    duration: number
    aspectRatio: string
    provider: string
    referenceImageCount: number
  }
  happyHorseBody: Record<string, unknown>
}

type OutputConfig = {
  videoCount: number
  fullVideoDurationS: number
  sceneDurationS: number
  sceneCount: number
}

type VideoRequestPreview = {
  outputConfig: OutputConfig | null
  referenceImages: string[]
  promptCount: number
  promptsMeta?: {
    reason?: string
  } | null
  pipelineVideoOpts: {
    resolution: string
    duration: number
    aspectRatio: string
  }
  providerSelection: {
    selectedProvider: string | null
    providers: ProviderEntry[]
  }
  happyHorse: {
    endpoint: string
    method: string
    settingOptions: SettingOption[]
    negativePromptHandling: string
  }
  requests: RequestEntry[]
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function toneForStatus(status: ProviderEntry['health']['status']): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'free':
      return 'default'
    case 'degraded':
    case 'busy':
      return 'secondary'
    case 'down':
      return 'destructive'
    default:
      return 'outline'
  }
}

export function VideoRequestPreflightPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<VideoRequestPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/runs/${runId}/video-request-preview`, { cache: 'no-store' })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(json.error?.message ?? 'Préflight indisponible')
          setData(null)
          return
        }
        setData(json.data as VideoRequestPreview)
      } catch (loadError) {
        if (!cancelled) {
          setError((loadError as Error).message)
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [runId])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Préflight requête vidéo</CardTitle>
          <CardDescription>Lecture du payload provider en cours…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Préflight requête vidéo</CardTitle>
          <CardDescription>Impossible d’afficher le détail provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Préflight vidéo — body HappyHorse</CardTitle>
          <Badge variant="outline">{data.promptCount} prompt(s)</Badge>
          <Badge variant={data.providerSelection.selectedProvider === 'happyhorse' ? 'default' : 'secondary'}>
            provider retenu pipeline : {data.providerSelection.selectedProvider ?? 'aucun'}
          </Badge>
        </div>
        <CardDescription>
          Tu vois ici le body HappyHorse exact, scène par scène, ainsi que le provider actuellement retenu par le pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.promptCount === 0 && data.promptsMeta?.reason && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {data.promptsMeta.reason}
          </div>
        )}

        {data.providerSelection.selectedProvider && data.providerSelection.selectedProvider !== 'happyhorse' && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Le provider retenu par le pipeline est actuellement <strong>{data.providerSelection.selectedProvider}</strong>. Le détail ci-dessous montre malgré tout le <strong>body HappyHorse exact</strong> pour audit et comparaison avant envoi.
          </div>
        )}

        {data.outputConfig && (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border p-3 text-xs">
              <div className="text-muted-foreground">Vidéos prévues</div>
              <div className="mt-1 text-sm font-semibold">{data.outputConfig.videoCount}</div>
            </div>
            <div className="rounded-md border p-3 text-xs">
              <div className="text-muted-foreground">Vidéo entière</div>
              <div className="mt-1 text-sm font-semibold">{data.outputConfig.fullVideoDurationS}s</div>
            </div>
            <div className="rounded-md border p-3 text-xs">
              <div className="text-muted-foreground">Durée scène</div>
              <div className="mt-1 text-sm font-semibold">{data.outputConfig.sceneDurationS}s</div>
            </div>
            <div className="rounded-md border p-3 text-xs">
              <div className="text-muted-foreground">Scènes verrouillées</div>
              <div className="mt-1 text-sm font-semibold">{data.outputConfig.sceneCount}</div>
            </div>
          </div>
        )}

        {data.referenceImages.length > 0 && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm font-medium">Images de référence projet</div>
            <div className="space-y-1">
              {data.referenceImages.map((url, index) => (
                <div key={url} className="rounded-md border bg-muted/20 px-3 py-2 text-xs break-all">
                  <strong>Image {index + 1}</strong> · {url}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-md border p-3 space-y-3">
          <div>
            <div className="text-sm font-medium">Chaîne provider vidéo</div>
            <div className="text-xs text-muted-foreground">
              Le pipeline standard exclut `sketch-local` pour un clip final.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.providerSelection.providers.map((provider) => (
              <div key={provider.name} className="rounded-full border px-2 py-1 text-xs">
                <div className="flex items-center gap-2">
                  <span>{provider.name}</span>
                  <Badge variant={toneForStatus(provider.health.status)}>{provider.health.status}</Badge>
                  {provider.excludedFromStandard && <Badge variant="outline">exclu pipeline</Badge>}
                </div>
                {provider.health.details && (
                  <div className="mt-1 text-[10px] text-muted-foreground">{provider.health.details}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border p-3 space-y-3">
          <div className="text-sm font-medium">Réglages HappyHorse disponibles / pris</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.happyHorse.settingOptions.map((setting) => (
              <div key={setting.key} className="rounded-md border bg-muted/20 p-2 text-xs">
                <div className="font-medium">{setting.key}</div>
                <div className="mt-1 text-muted-foreground">dispo : {setting.available.join(' · ')}</div>
                <div className="mt-1">pris : <strong>{setting.selected}</strong></div>
              </div>
            ))}
          </div>
          <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-1">
            <div><strong>Endpoint :</strong> {data.happyHorse.method} {data.happyHorse.endpoint}</div>
            <div><strong>Negative prompt :</strong> {data.happyHorse.negativePromptHandling}</div>
            <div><strong>Réglages pipeline globaux :</strong> {data.pipelineVideoOpts.duration}s · {data.pipelineVideoOpts.aspectRatio} · {data.pipelineVideoOpts.resolution}</div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">Payload scène par scène</div>
          {data.requests.map((request) => (
            <div key={request.sceneIndex} className="rounded-md border p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold">Scène {request.sceneIndex}</div>
                <Badge variant="outline">{request.chosenSettings.duration}s</Badge>
                <Badge variant="outline">{request.chosenSettings.aspectRatio}</Badge>
                <Badge variant="outline">{request.chosenSettings.resolution}</Badge>
                <Badge variant="outline">{request.chosenSettings.referenceImageCount} image(s) ref</Badge>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Prompt envoyé à HappyHorse</div>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-xs">{request.prompt}</pre>
              </div>

              {request.negativePrompt && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Negative prompt enregistré mais non envoyé actuellement : {request.negativePrompt}
                </div>
              )}

              <details className="rounded-md border bg-muted/10 p-3">
                <summary className="cursor-pointer text-xs font-medium">Voir le body exact</summary>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {Object.entries(request.happyHorseBody).map(([key, value]) => (
                    <div key={key} className="rounded-md border bg-background p-2 text-xs">
                      <div className="font-medium">{key}</div>
                      <div className="mt-1 break-all text-muted-foreground">{formatValue(value)}</div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
