'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type Metadata = {
  description?: string
  hashtags?: string[]
  title_variants?: Record<string, string>
}

type ArtifactInfo = { name: string; sizeBytes: number }

type PreviewManifest = {
  mode: 'video_finale' | 'animatic' | 'storyboard_only' | 'none'
  playableFilePath: string | null
  mediaType: string | null
  hasAudio: boolean
  mediaFile: string | null
}

type PublishStatus = 'SUCCESS' | 'PROCESSING' | 'FAILED' | 'NO_CREDENTIALS' | 'NO_MEDIA' | 'not_published'

type PublishResult = {
  status: PublishStatus
  publishId?: string
  videoId?: string
  shareUrl?: string
  error?: string
  credentials?: { hasAccessToken: boolean; hasClientKey: boolean }
  instructions?: string
  publishedAt?: string
  title?: string
  mediaMode?: string
  tiktokHealth?: { status: string; details: string }
}

const MODE_LABELS: Record<string, string> = {
  video_finale: 'Vidéo finale',
  animatic: 'Animatic',
  storyboard_only: 'Storyboard seul',
  none: 'Aucun média',
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

export default function ExportPage() {
  const { id } = useParams<{ id: string }>()
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [manifest, setManifest] = useState<PreviewManifest | null>(null)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([])
  const [imageCount, setImageCount] = useState(0)
  const [loadingArtifacts, setLoadingArtifacts] = useState(false)

  const loadExportData = useCallback(async () => {
    const res = await fetch(`/api/runs/${id}/export`)
    const json = await res.json()
    if (json.data) setMetadata(json.data.metadata)
  }, [id])

  const loadManifest = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/preview-manifest`)
      if (res.ok) {
        const json = await res.json()
        if (json.data) setManifest(json.data)
      }
    } catch { /* silencieux */ }
  }, [id])

  const loadPublishStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/publish`)
      if (res.ok) {
        const json = await res.json()
        if (json.data) setPublishResult(json.data)
      }
    } catch { /* silencieux */ }
  }, [id])

  useEffect(() => {
    void Promise.all([loadExportData(), loadManifest(), loadPublishStatus()])
  }, [loadExportData, loadManifest, loadPublishStatus])

  async function handleRegenerate() {
    setRegenerating(true)
    const res = await fetch(`/api/runs/${id}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'regenerate_metadata' }),
    })
    const json = await res.json()
    if (json.data) setMetadata(json.data)
    setRegenerating(false)
  }

  async function handleListArtifacts() {
    setLoadingArtifacts(true)
    const res = await fetch(`/api/runs/${id}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'download_artifacts' }),
    })
    const json = await res.json()
    if (json.data) {
      setArtifacts(json.data.artifacts)
      setImageCount(json.data.storyboardImages?.length ?? 0)
    }
    setLoadingArtifacts(false)
  }

  async function handlePublishTikTok() {
    setPublishing(true)
    try {
      const res = await fetch(`/api/runs/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'tiktok' }),
      })
      const json = await res.json()
      if (json.data) setPublishResult(json.data)
    } catch {
      setPublishResult({ status: 'FAILED', error: 'Erreur réseau' })
    } finally {
      setPublishing(false)
    }
  }

  const hasPlayable = !!(manifest?.playableFilePath)
  const mode = manifest?.mode ?? 'none'
  const publishStatus = publishResult?.status ?? 'not_published'

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Artefacts & Export</h1>
        {manifest && (
          <Badge variant={mode === 'video_finale' ? 'default' : mode === 'animatic' ? 'secondary' : 'outline'}>
            {MODE_LABELS[mode] ?? mode}
          </Badge>
        )}
      </div>

      {/* État média honnête */}
      {hasPlayable ? (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {mode === 'video_finale'
            ? 'Vidéo finale disponible — clips vidéo réels assemblés.'
            : 'Animatic disponible — slideshow storyboard' + (manifest?.hasAudio ? ' + audio' : '') + '.'}
          {' '}Fichier : <code className="text-[11px]">{manifest?.mediaFile ?? 'final/'}</code>
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {mode === 'storyboard_only'
            ? 'Storyboard disponible, mais aucun fichier média playable assemblé.'
            : 'Aucun fichier média playable. Les artefacts texte et storyboard restent consultables ci-dessous.'}
        </div>
      )}

      {/* Publication TikTok */}
      <Card>
        <CardHeader className="py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Publication TikTok</CardTitle>
              <Badge variant={PUBLISH_STATUS_VARIANTS[publishStatus]}>
                {PUBLISH_STATUS_LABELS[publishStatus]}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handlePublishTikTok}
              disabled={publishing}
            >
              {publishing ? 'Publication...' : publishStatus === 'SUCCESS' ? 'Re-publier' : 'Publier sur TikTok'}
            </Button>
          </div>

          {/* Résultat de publication */}
          {publishResult && publishResult.status !== 'not_published' && (
            <div className="space-y-1.5">
              {publishResult.status === 'SUCCESS' && (
                <div className="rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-800">
                  <p className="font-medium">✓ Publié sur TikTok</p>
                  {publishResult.publishId && (
                    <p>Publish ID : <code className="text-[10px]">{publishResult.publishId}</code></p>
                  )}
                  {publishResult.videoId && (
                    <p>Video ID : <code className="text-[10px]">{publishResult.videoId}</code></p>
                  )}
                  {publishResult.publishedAt && (
                    <p className="text-[10px] text-green-600">{new Date(publishResult.publishedAt).toLocaleString()}</p>
                  )}
                </div>
              )}

              {publishResult.status === 'PROCESSING' && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                  <p className="font-medium">Publication en cours de traitement</p>
                  {publishResult.publishId && (
                    <p>Publish ID : <code className="text-[10px]">{publishResult.publishId}</code></p>
                  )}
                  <p className="text-[10px]">Vérifiable manuellement sur https://developers.tiktok.com</p>
                </div>
              )}

              {publishResult.status === 'NO_CREDENTIALS' && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 space-y-1">
                  <p className="font-medium">Credentials TikTok absents</p>
                  <div className="flex gap-2">
                    <span>TIKTOK_ACCESS_TOKEN :</span>
                    <Badge variant={publishResult.credentials?.hasAccessToken ? 'default' : 'destructive'} className="text-[9px]">
                      {publishResult.credentials?.hasAccessToken ? 'présent' : 'absent'}
                    </Badge>
                  </div>
                  {publishResult.instructions && (
                    <pre className="text-[9px] whitespace-pre-wrap text-amber-700 mt-1 font-mono leading-relaxed">
                      {publishResult.instructions}
                    </pre>
                  )}
                  <p className="pt-1 text-[10px] text-amber-700">
                    Si l’app est déployée en HTTPS, lance l’assistant OAuth via{' '}
                    <a
                      href="/tiktok/connect"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      /tiktok/connect
                    </a>
                    .
                  </p>
                </div>
              )}

              {(publishResult.status === 'FAILED' || publishResult.status === 'NO_MEDIA') && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  <p className="font-medium">
                    {publishResult.status === 'NO_MEDIA' ? 'Pas de fichier vidéo disponible' : 'Échec de publication'}
                  </p>
                  {publishResult.error && <p className="text-[10px] mt-0.5">{publishResult.error}</p>}
                </div>
              )}

              {/* publish-result.json persisté */}
              <p className="text-[9px] text-muted-foreground">
                Résultat persisté dans{' '}
                <code>storage/runs/{id}/final/publish-result.json</code>
              </p>
            </div>
          )}

          {/* Healthcheck si non publié */}
          {(!publishResult || publishResult.status === 'not_published') && (
            <CardDescription>
              {publishResult?.tiktokHealth?.status === 'ready'
                ? 'Credentials TikTok valides. Cliquez sur Publier pour lancer la publication.'
                : publishResult?.tiktokHealth?.status === 'no_credentials'
                ? 'TIKTOK_ACCESS_TOKEN absent — définir dans .env.local, ou ouvrir /tiktok/connect sur l’instance HTTPS déployée.'
                : 'Cliquez sur Publier pour tenter la publication TikTok.'}
            </CardDescription>
          )}
        </CardHeader>
      </Card>

      {/* Métadonnées */}
      <Card>
        <CardHeader className="py-3 space-y-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Métadonnées</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? 'Génération...' : 'Régénérer via IA'}
            </Button>
          </div>

          {metadata ? (
            <div className="space-y-2">
              <CardDescription>{metadata.description || 'Aucune description'}</CardDescription>
              {metadata.hashtags && metadata.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {metadata.hashtags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                  ))}
                </div>
              )}
              {metadata.title_variants && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {Object.entries(metadata.title_variants).map(([platform, title]) => (
                    <div key={platform}><span className="font-medium">{platform}:</span> {title}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <CardDescription>Pas encore de métadonnées. Cliquez sur Régénérer via IA.</CardDescription>
          )}
        </CardHeader>
      </Card>

      {/* Artefacts du run */}
      <Card>
        <CardHeader className="py-3 space-y-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Artefacts du run</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleListArtifacts}
              disabled={loadingArtifacts}
            >
              {loadingArtifacts ? 'Chargement...' : 'Lister les fichiers'}
            </Button>
          </div>

          {artifacts.length > 0 ? (
            <div className="space-y-1">
              {artifacts.map((a) => (
                <div key={a.name} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{a.name}</span>
                  <span className="text-muted-foreground">{(a.sizeBytes / 1024).toFixed(1)} KB</span>
                </div>
              ))}
              {imageCount > 0 && (
                <div className="text-xs text-muted-foreground mt-1">
                  + {imageCount} image(s) storyboard (PNG)
                </div>
              )}
            </div>
          ) : (
            <CardDescription>
              Cliquez sur Lister pour voir les artefacts produits par le pipeline.
            </CardDescription>
          )}
        </CardHeader>
      </Card>

      <p className="text-xs text-muted-foreground">
        Les artefacts sont disponibles dans <code className="text-[10px]">storage/runs/{id}/</code>.
      </p>
    </div>
  )
}
