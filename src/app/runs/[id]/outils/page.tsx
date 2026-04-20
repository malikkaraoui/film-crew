'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

type PublishStatus = 'SUCCESS' | 'PROCESSING' | 'FAILED' | 'NO_CREDENTIALS' | 'NO_MEDIA' | 'not_published'

type PublishResult = {
  status: PublishStatus
  publishId?: string
  videoId?: string
  shareUrl?: string
  profileUrl?: string
  publishedAt?: string
  error?: string
  credentials?: { hasAccessToken: boolean; hasClientKey: boolean }
  tiktokHealth?: { status: string; details: string }
}

type RouteEntry = {
  method: 'GET' | 'POST'
  path: string
  description: string
  category: 'pipeline' | 'media' | 'publication' | 'debug'
}

const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  SUCCESS: 'Publié',
  PROCESSING: 'En cours',
  FAILED: 'Échec',
  NO_CREDENTIALS: 'Credentials manquants',
  NO_MEDIA: 'Pas de média',
  not_published: 'Non publié',
}

const PUBLISH_STATUS_VARIANTS: Record<PublishStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  SUCCESS: 'default',
  PROCESSING: 'secondary',
  FAILED: 'destructive',
  NO_CREDENTIALS: 'outline',
  NO_MEDIA: 'destructive',
  not_published: 'outline',
}

const ROUTES: RouteEntry[] = [
  // Pipeline
  { method: 'GET', path: '/api/runs/{id}', description: 'État du run, étapes, coût, statut global', category: 'pipeline' },
  { method: 'POST', path: '/api/runs/{id}/step-back', description: 'Revenir à une étape précédente (body: { targetStep })', category: 'pipeline' },
  { method: 'POST', path: '/api/runs/{id}/kill', description: 'Arrêter le pipeline en cours', category: 'pipeline' },
  { method: 'GET', path: '/api/runs/{id}/meeting', description: 'Transcript de la réunion de brainstorm (step 2)', category: 'pipeline' },
  { method: 'GET', path: '/api/runs/{id}/traces', description: 'Traces d\'exécution détaillées du pipeline', category: 'pipeline' },
  // Média
  { method: 'GET', path: '/api/runs/{id}/storyboard', description: 'Images storyboard générées (liste + statut)', category: 'media' },
  { method: 'GET', path: '/api/runs/{id}/storyboard/image/{i}', description: 'Image storyboard d\'une scène (renvoie le PNG)', category: 'media' },
  { method: 'GET', path: '/api/runs/{id}/clips', description: 'Clips vidéo générés, provider, statut, filePath', category: 'media' },
  { method: 'GET', path: '/api/runs/{id}/media', description: 'Fichier média final (vidéo ou animatic) en streaming', category: 'media' },
  { method: 'GET', path: '/api/runs/{id}/preview-manifest', description: 'Mode de preview, playableFilePath, hasAudio', category: 'media' },
  { method: 'POST', path: '/api/runs/{id}/regenerate-scene', description: 'Régénérer une scène ciblée (body: { type, sceneIndex })', category: 'media' },
  { method: 'GET', path: '/api/runs/{id}/export', description: 'Métadonnées export (titre, hashtags, plateformes)', category: 'media' },
  { method: 'POST', path: '/api/runs/{id}/export', description: 'Régénérer métadonnées IA ou lister artefacts (body: { action })', category: 'media' },
  // Publication
  { method: 'GET', path: '/api/runs/{id}/publish', description: 'Statut de publication TikTok (ou not_published + healthcheck)', category: 'publication' },
  { method: 'POST', path: '/api/runs/{id}/publish', description: 'Déclencher publication TikTok (body: { platform: "tiktok" })', category: 'publication' },
  { method: 'POST', path: '/api/runs/{id}/localize', description: 'Localiser le run dans une autre langue', category: 'publication' },
  // Debug
  { method: 'GET', path: '/api/runs/{id}/failover-log', description: 'Historique des failovers providers (image, video, audio)', category: 'debug' },
  { method: 'GET', path: '/api/providers', description: 'État de santé de tous les providers (healthcheck)', category: 'debug' },
  { method: 'GET', path: '/api/runs/estimate', description: 'Estimation de coût d\'un run complet', category: 'debug' },
]

const CATEGORY_LABELS: Record<string, string> = {
  pipeline: 'Pipeline',
  media: 'Média',
  publication: 'Publication',
  debug: 'Debug / Observabilité',
}

const CATEGORY_ORDER = ['pipeline', 'publication', 'media', 'debug']

const METHOD_VARIANTS: Record<string, string> = {
  GET: 'bg-blue-50 text-blue-700 border-blue-200',
  POST: 'bg-green-50 text-green-700 border-green-200',
}

export default function OutilsPage() {
  const { id } = useParams<{ id: string }>()
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [pollingActive, setPollingActive] = useState(false)

  const loadPublishStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/publish`)
      if (res.ok) {
        const json = await res.json()
        if (json.data) setPublishResult(json.data)
      }
    } catch { /* silencieux */ }
  }, [id])

  // Chargement initial
  useEffect(() => {
    void loadPublishStatus()
  }, [loadPublishStatus])

  // Polling automatique si PROCESSING (arrêt sur état terminal, timeout 5min)
  useEffect(() => {
    if (publishResult?.status !== 'PROCESSING') {
      setPollingActive(false)
      return
    }
    setPollingActive(true)
    let elapsed = 0
    const interval = setInterval(async () => {
      elapsed += 5
      await loadPublishStatus()
      if (elapsed >= 300) clearInterval(interval) // timeout 5min
    }, 5000)
    return () => clearInterval(interval)
  }, [publishResult?.status, loadPublishStatus])

  const publishStatus = publishResult?.status ?? 'not_published'
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    routes: ROUTES.filter((r) => r.category === cat),
  }))

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Outils & API disponibles</h1>

      {/* Statut publication en haut */}
      <Card>
        <CardHeader className="py-3 space-y-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Publication TikTok</CardTitle>
            <Badge variant={PUBLISH_STATUS_VARIANTS[publishStatus]}>
              {PUBLISH_STATUS_LABELS[publishStatus]}
            </Badge>
            {pollingActive && (
              <span className="text-[10px] text-muted-foreground animate-pulse">polling…</span>
            )}
          </div>

          {publishResult?.status === 'SUCCESS' && (
            <div className="rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-800 space-y-0.5">
              {publishResult.publishId && (
                <p>Publish ID : <code className="text-[10px]">{publishResult.publishId}</code></p>
              )}
              {publishResult.videoId && (
                <p>Video ID : <code className="text-[10px]">{publishResult.videoId}</code></p>
              )}
              {publishResult.publishedAt && (
                <p className="text-[10px] text-green-600">{new Date(publishResult.publishedAt).toLocaleString()}</p>
              )}
              {publishResult.profileUrl && (
                <p>
                  <a href={publishResult.profileUrl} target="_blank" rel="noreferrer" className="underline text-green-700">
                    Voir sur TikTok
                  </a>
                </p>
              )}
            </div>
          )}

          {publishResult?.status === 'PROCESSING' && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
              <p>Traitement en cours — polling automatique toutes les 5s</p>
              {publishResult.publishId && (
                <p className="text-[10px] mt-0.5">Publish ID : <code>{publishResult.publishId}</code></p>
              )}
            </div>
          )}

          {(publishResult?.status === 'FAILED' || publishResult?.status === 'NO_MEDIA') && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {publishResult.error && <p>{publishResult.error}</p>}
            </div>
          )}

          {publishResult?.status === 'NO_CREDENTIALS' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 space-y-1">
              <p>Configurer <code className="text-[10px]">TIKTOK_ACCESS_TOKEN</code> dans <code className="text-[10px]">.env.local</code></p>
              <div className="flex gap-2 items-center">
                <span>Access token :</span>
                <Badge variant={publishResult.credentials?.hasAccessToken ? 'default' : 'destructive'} className="text-[9px]">
                  {publishResult.credentials?.hasAccessToken ? 'présent' : 'absent'}
                </Badge>
              </div>
            </div>
          )}

          {publishResult?.status === 'not_published' && (
            <CardDescription>
              {publishResult.tiktokHealth?.status === 'ready'
                ? 'Credentials valides. Aller sur Exporter pour publier.'
                : publishResult.tiktokHealth?.status === 'no_credentials'
                ? 'TIKTOK_ACCESS_TOKEN absent.'
                : 'Pas encore publié.'}
            </CardDescription>
          )}

          <Button
            variant="outline"
            size="sm"
            className="text-xs w-fit"
            onClick={() => void loadPublishStatus()}
          >
            Rafraîchir le statut
          </Button>
        </CardHeader>
      </Card>

      {/* Catalogue des routes */}
      {grouped.map(({ cat, routes }) => (
        <div key={cat}>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">{CATEGORY_LABELS[cat]}</h2>
          <div className="space-y-1.5">
            {routes.map((r) => (
              <div
                key={`${r.method}-${r.path}`}
                className="flex items-start gap-2 rounded-md border border-input px-3 py-2 text-xs"
              >
                <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${METHOD_VARIANTS[r.method]}`}>
                  {r.method}
                </span>
                <div className="min-w-0">
                  <code className="block text-[11px] font-mono text-foreground">
                    {r.path.replace('{id}', id).replace('{i}', 'N')}
                  </code>
                  <p className="text-muted-foreground mt-0.5">{r.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
