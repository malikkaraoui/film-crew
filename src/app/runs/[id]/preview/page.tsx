'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type Clip = {
  id: string
  stepIndex: number
  prompt: string
  provider: string
  status: string
  filePath: string | null
  seed: number | null
  costEur: number | null
}

type StoryboardImage = {
  sceneIndex: number
  description: string
  filePath: string
  status: 'pending' | 'generated' | 'validated' | 'rejected'
}

type PreviewManifest = {
  mode: 'video_finale' | 'animatic' | 'storyboard_only' | 'none'
  playableFilePath: string | null
  mediaType: string | null
  hasAudio: boolean
  assemblyError: string | null
}

type FailoverEntry = {
  type?: string
  sceneIndex?: number
  original?: string
  fallback?: string
  providerUsed?: string
  failoverOccurred?: boolean
  failoverChain?: { original: string; fallback: string; reason: string }
  success?: boolean
  error?: string
  reason?: string
  timestamp: string
}

type DirectorPlan = {
  tone: string
  style: string
  creativeDirection: string
  shotList: {
    sceneIndex: number
    intent: string
    camera: string
    emotion: string
    influencedBy: string[]
  }[]
}

type PublishStatus = 'SUCCESS' | 'PROCESSING' | 'FAILED' | 'NO_CREDENTIALS' | 'NO_MEDIA' | 'not_published'

type PublishResult = {
  status: PublishStatus
  publishId?: string
  videoId?: string
  shareUrl?: string
  profileUrl?: string
  error?: string
  credentials?: { hasAccessToken: boolean; hasClientKey: boolean }
  publishedAt?: string
  mediaMode?: string
  mediaSizeBytes?: number
  tiktokHealth?: { status: string; details: string }
}

const MODE_LABELS: Record<string, string> = {
  video_finale: 'Vidéo finale',
  animatic: 'Animatic',
  storyboard_only: 'Storyboard seul',
  none: 'Aucun média',
}

const MODE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  video_finale: 'default',
  animatic: 'secondary',
  storyboard_only: 'outline',
  none: 'destructive',
}

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>()
  const [clips, setClips] = useState<Clip[]>([])
  const [storyboard, setStoryboard] = useState<StoryboardImage[]>([])
  const [manifest, setManifest] = useState<PreviewManifest | null>(null)
  const [failoverLog, setFailoverLog] = useState<FailoverEntry[]>([])
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [directorPlan, setDirectorPlan] = useState<DirectorPlan | null>(null)
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({})
  const [regenResult, setRegenResult] = useState<Record<number, { ok: boolean; provider: string; failover: boolean; error?: string }>>({})

  const loadClips = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/clips`)
      const json = await res.json()
      if (json.data) setClips(json.data)
    } catch { /* silencieux */ }
  }, [id])

  const loadStoryboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/storyboard`)
      const json = await res.json()
      if (json.data?.images) setStoryboard(json.data.images)
    } catch { /* silencieux */ }
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

  const loadFailoverLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/failover-log`)
      if (res.ok) {
        const json = await res.json()
        if (json.data) setFailoverLog(json.data)
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

  const loadDirectorPlan = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/director-plan`)
      if (res.ok) {
        const json = await res.json()
        if (json.data) setDirectorPlan(json.data as DirectorPlan)
      }
    } catch { /* silencieux */ }
  }, [id])

  useEffect(() => {
    void Promise.all([loadClips(), loadStoryboard(), loadManifest(), loadFailoverLog(), loadPublishStatus(), loadDirectorPlan()])
      .then(() => setLoading(false))
  }, [loadClips, loadStoryboard, loadManifest, loadFailoverLog, loadPublishStatus, loadDirectorPlan])

  // Polling automatique si PROCESSING — arrêt sur état terminal, timeout 5min
  useEffect(() => {
    if (publishResult?.status !== 'PROCESSING') return
    let elapsed = 0
    const interval = setInterval(async () => {
      elapsed += 5
      await loadPublishStatus()
      if (elapsed >= 300) clearInterval(interval)
    }, 5000)
    return () => clearInterval(interval)
  }, [publishResult?.status, loadPublishStatus])

  async function handleRegenerate(type: 'storyboard' | 'video', sceneIndex: number) {
    setRegenerating((prev) => ({ ...prev, [sceneIndex]: true }))
    setRegenResult((prev) => {
      const next = { ...prev }
      delete next[sceneIndex]
      return next
    })

    try {
      const res = await fetch(`/api/runs/${id}/regenerate-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, sceneIndex }),
      })
      const json = await res.json()

      if (res.ok && json.data) {
        setRegenResult((prev) => ({
          ...prev,
          [sceneIndex]: {
            ok: true,
            provider: json.data.providerUsed,
            failover: json.data.failoverOccurred,
          },
        }))
        // Recharger storyboard + failover-log après régénération réussie
        await Promise.all([loadStoryboard(), loadFailoverLog()])
      } else {
        setRegenResult((prev) => ({
          ...prev,
          [sceneIndex]: {
            ok: false,
            provider: json.error?.providerUsed ?? 'none',
            failover: false,
            error: json.error?.message ?? 'Erreur inconnue',
          },
        }))
        await loadFailoverLog()
      }
    } catch {
      setRegenResult((prev) => ({
        ...prev,
        [sceneIndex]: { ok: false, provider: 'none', failover: false, error: 'Erreur réseau' },
      }))
    } finally {
      setRegenerating((prev) => ({ ...prev, [sceneIndex]: false }))
    }
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

  if (loading) return <p className="text-sm text-muted-foreground">Chargement...</p>

  const completedClips = clips.filter(c => c.status === 'completed')
  const generatedImages = storyboard.filter(i => i.status === 'generated')
  const hasPlayable = !!(manifest?.playableFilePath)
  const hasClips = completedClips.length > 0
  const hasStoryboard = generatedImages.length > 0
  const mode = manifest?.mode ?? 'none'
  const publishStatus = publishResult?.status ?? 'not_published'

  // Failovers visibles :
  // - RegenerationAttempt avec failover ou en échec
  // - FailoverEvent brut (persisté par executeWithFailover, pas de champ "success")
  const visibleFailovers = failoverLog.filter(
    (e) =>
      (e.failoverOccurred ?? false) ||
      (e.success === false) ||
      ('original' in e && 'fallback' in e && !('success' in e)),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Preview</h1>
        <Badge variant={MODE_VARIANTS[mode] ?? 'outline'}>
          {MODE_LABELS[mode] ?? mode}
        </Badge>
        {manifest?.hasAudio && (
          <Badge variant="outline" className="text-xs">Audio</Badge>
        )}
      </div>

      {/* Bandeau failover — honnête et non masqué */}
      {visibleFailovers.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1">
          <p className="text-xs font-medium text-amber-800">
            {visibleFailovers.length} bascule(s) / échec(s) provider sur ce run
          </p>
          {visibleFailovers.map((e, i) => (
            <div key={i} className="text-[11px] text-amber-700">
              {'original' in e && !('success' in e)
                ? `Bascule — ${e.original} → ${e.fallback} (${e.type ?? ''}) : ${e.reason ?? ''}`
                : e.failoverOccurred && e.failoverChain
                ? `Sc.${e.sceneIndex ?? '?'} ${e.type ?? ''} — ${e.failoverChain.original} → ${e.failoverChain.fallback} (via ${e.providerUsed})`
                : e.success === false
                ? `Sc.${e.sceneIndex ?? '?'} ${e.type ?? ''} — Échec : ${e.providerUsed} — ${e.error ?? 'inconnu'}`
                : null}
            </div>
          ))}
        </div>
      )}

      {/* Direction créative — 10C */}
      {directorPlan && (
        <div className="rounded-md border border-violet-200 bg-violet-50/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-violet-800">Direction créative</p>
            <span className="text-[10px] text-violet-500 border border-violet-300 rounded-full px-1.5">Réalisateur IA</span>
          </div>
          <div className="flex gap-3 text-[11px] text-violet-700">
            <span>Ton : <strong>{directorPlan.tone}</strong></span>
            <span>·</span>
            <span>Style : <strong>{directorPlan.style}</strong></span>
          </div>
          {directorPlan.creativeDirection && (
            <p className="text-[11px] text-violet-700 italic leading-relaxed">
              {directorPlan.creativeDirection}
            </p>
          )}
          {directorPlan.shotList.length > 0 && (
            <div className="space-y-1 pt-1">
              {directorPlan.shotList.map((shot) => (
                <div key={shot.sceneIndex} className="flex gap-2 text-[10px] text-violet-600">
                  <span className="shrink-0 font-mono font-medium">S{shot.sceneIndex}</span>
                  <span className="text-muted-foreground">{shot.camera}</span>
                  <span className="truncate">{shot.intent}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Player vidéo ou animatic */}
      {hasPlayable && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {mode === 'video_finale'
              ? 'Clips vidéo réels assemblés'
              : 'Animatic — slideshow storyboard' + (manifest?.hasAudio ? ' + audio' : '')}
          </p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            controls
            className="w-full max-w-xs rounded-lg border bg-black"
            style={{ aspectRatio: '9/16' }}
            src={`/api/runs/${id}/media`}
            preload="metadata"
          />

          <div className="rounded-md border p-3 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">TikTok</span>
              <Badge variant={publishStatus === 'SUCCESS' ? 'default' : publishStatus === 'PROCESSING' ? 'secondary' : publishStatus === 'not_published' ? 'outline' : 'destructive'}>
                {publishStatus === 'SUCCESS'
                  ? 'Publié'
                  : publishStatus === 'PROCESSING'
                  ? 'En cours'
                  : publishStatus === 'NO_CREDENTIALS'
                  ? 'Credentials manquants'
                  : publishStatus === 'NO_MEDIA'
                  ? 'Pas de média'
                  : publishStatus === 'FAILED'
                  ? 'Échec'
                  : 'Non publié'}
              </Badge>
              <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={handlePublishTikTok} disabled={publishing}>
                {publishing ? 'Publication...' : publishStatus === 'SUCCESS' ? 'Re-publier' : 'Publier sur TikTok'}
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => void loadPublishStatus()}>
                Rafraîchir
              </Button>
            </div>

            <div className="grid gap-1 text-muted-foreground">
              <p>Mode : <span className="text-foreground">{MODE_LABELS[mode] ?? mode}</span></p>
              {publishResult?.publishId && <p>Publish ID : <code className="text-[10px]">{publishResult.publishId}</code></p>}
              {publishResult?.videoId && <p>Video ID : <code className="text-[10px]">{publishResult.videoId}</code></p>}
              {publishResult?.mediaSizeBytes && <p>Taille vidéo : <span className="text-foreground">{(publishResult.mediaSizeBytes / (1024 * 1024)).toFixed(2)} MB</span></p>}
              {publishResult?.publishedAt && <p>Publié le : <span className="text-foreground">{new Date(publishResult.publishedAt).toLocaleString()}</span></p>}
              {publishResult?.shareUrl && (
                <p>
                  Lien vidéo :{' '}
                  <a href={publishResult.shareUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-foreground">
                    ouvrir
                  </a>
                </p>
              )}
              {!publishResult?.shareUrl && publishResult?.profileUrl && (
                <p>
                  Profil TikTok :{' '}
                  <a href={publishResult.profileUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-foreground">
                    ouvrir le profil
                  </a>
                </p>
              )}
              {publishResult?.error && <p className="text-destructive">Erreur : {publishResult.error}</p>}
              {publishResult?.tiktokHealth?.details && publishStatus === 'not_published' && <p>{publishResult.tiktokHealth.details}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Erreur d'assemblage */}
      {manifest?.assemblyError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          Erreur assemblage : {manifest.assemblyError}
        </div>
      )}

      {/* État réel du run (quand pas de playable) */}
      {!hasPlayable && (
        <div className="rounded-md border p-3 text-sm">
          {hasClips ? (
            <p className="text-amber-700">{completedClips.length} clip(s) présent(s) — assemblage non encore exécuté (step 7 non atteint).</p>
          ) : hasStoryboard ? (
            <p className="text-amber-700">Storyboard disponible. Pas de clips vidéo (providers non configurés). Aucun animatic assemblé.</p>
          ) : (
            <p className="text-muted-foreground">Aucun artefact visuel disponible. Le pipeline doit atteindre au moins le step 4 (Storyboard).</p>
          )}
        </div>
      )}

      {/* Storyboard avec boutons de régénération ciblée */}
      {storyboard.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">
            Storyboard — {storyboard.length} scène(s)
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">
              (bouton Régénérer = scène ciblée uniquement)
            </span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {storyboard.map((img) => {
              const regen = regenResult[img.sceneIndex]
              const isRegenerating = regenerating[img.sceneIndex] ?? false

              return (
                <div key={img.sceneIndex} className="rounded-lg border overflow-hidden">
                  <div className="aspect-9/16 bg-muted relative">
                    <span className="absolute top-2 left-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-mono z-10">
                      {img.sceneIndex}
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/runs/${id}/storyboard/image/${img.sceneIndex}`}
                      alt={`Scène ${img.sceneIndex}`}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  </div>
                  <div className="p-2 space-y-1.5">
                    <p className="text-xs text-muted-foreground line-clamp-2">{img.description}</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant="secondary" className="text-[9px]">
                        {img.status === 'generated' ? 'Généré' : img.status}
                      </Badge>
                      {regen && (
                        <Badge
                          variant={regen.ok ? 'default' : 'destructive'}
                          className="text-[9px]"
                        >
                          {regen.ok
                            ? `✓ ${regen.provider}${regen.failover ? ' (basculé)' : ''}`
                            : `✗ ${regen.error ?? 'Échec'}`}
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-[10px] h-6"
                      onClick={() => handleRegenerate('storyboard', img.sceneIndex)}
                      disabled={isRegenerating}
                    >
                      {isRegenerating ? 'Régénération...' : 'Régénérer'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Timeline clips si présents */}
      {hasClips && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Clips vidéo — {completedClips.length}</h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {clips.map((c) => (
              <div key={c.id} className="shrink-0 w-28 rounded-lg border p-2 space-y-1">
                <div className="aspect-9/16 rounded bg-muted flex items-center justify-center">
                  <span className="text-xs font-mono text-muted-foreground">{c.stepIndex}</span>
                </div>
                <Badge
                  variant={c.status === 'completed' ? 'default' : 'destructive'}
                  className="text-[9px] w-full justify-center"
                >
                  {c.status === 'completed' ? 'OK' : 'Échec'}
                </Badge>
                {c.provider && c.provider !== 'video' && (
                  <p className="text-[9px] text-muted-foreground text-center">{c.provider}</p>
                )}
                <p className="text-[10px] text-muted-foreground line-clamp-2">{c.prompt}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-[10px] h-6"
                  onClick={() => handleRegenerate('video', c.stepIndex)}
                  disabled={regenerating[c.stepIndex] ?? false}
                >
                  {regenerating[c.stepIndex] ? '...' : 'Régénérer'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
