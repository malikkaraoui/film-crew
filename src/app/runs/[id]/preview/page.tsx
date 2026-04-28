'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PublishPanel } from '@/components/publish/publish-panel'
import { VideoRequestPreflightPanel } from '@/components/video/video-request-preflight-panel'
import type { PublishContext } from '@/components/publish/publish-panel'

type Clip = {
  id: string
  stepIndex: number
  prompt: string
  negativePrompt?: string | null
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
  providerUsed?: string | null
  failoverOccurred?: boolean
  isPlaceholder?: boolean
  cloudPlanStatus?: 'queued' | 'ready' | 'failed' | null
  cloudPlanModel?: string | null
  cloudPlanMode?: string | null
  cloudPlanAppliedAt?: string | null
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

async function collectPaidSceneConfirmation(sceneIndex: number): Promise<null | {
  confirmPaidGeneration: true
  confirmationText: string
}> {
  const proceed = window.confirm(
    `⚠️ Régénération vidéo payante réelle pour la scène ${sceneIndex}. Continuer ?`,
  )
  if (!proceed) return null

  const confirmationText = window.prompt(`Tape exactement SCENE ${sceneIndex} pour autoriser cette régénération payante`)?.trim()
  if (confirmationText !== `SCENE ${sceneIndex}`) {
    window.alert('Confirmation invalide. Régénération annulée.')
    return null
  }

  return {
    confirmPaidGeneration: true,
    confirmationText,
  }
}

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>()
  const [clips, setClips] = useState<Clip[]>([])
  const [storyboard, setStoryboard] = useState<StoryboardImage[]>([])
  const [manifest, setManifest] = useState<PreviewManifest | null>(null)
  const [failoverLog, setFailoverLog] = useState<FailoverEntry[]>([])
  const [publishContext, setPublishContext] = useState<PublishContext | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [directorPlan, setDirectorPlan] = useState<DirectorPlan | null>(null)
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({})
  const [regenResult, setRegenResult] = useState<Record<number, { ok: boolean; provider: string; failover: boolean; error?: string }>>({})
  const [promptDrafts, setPromptDrafts] = useState<Record<number, { prompt: string; negativePrompt: string }>>({})
  const [storyboardAssetVersion, setStoryboardAssetVersion] = useState('0')

  const loadClips = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/clips`)
      const json = await res.json()
      if (json.data) setClips(json.data)
    } catch { /* silencieux */ }
  }, [id])

  const loadPrompts = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/prompts`)
      const json = await res.json()
      if (json.data?.prompts) {
        setPromptDrafts(
          Object.fromEntries(
            json.data.prompts.map((entry: { sceneIndex: number; prompt: string; negativePrompt?: string }) => [
              entry.sceneIndex,
              { prompt: entry.prompt, negativePrompt: entry.negativePrompt ?? '' },
            ]),
          ),
        )
      }
    } catch { /* silencieux */ }
  }, [id])

  const loadStoryboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/storyboard`)
      const json = await res.json()
      if (json.data?.images) setStoryboard(json.data.images)
    } catch { /* silencieux */ }
    setStoryboardAssetVersion(`${Date.now()}`)
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

  const loadPublishContext = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/publication-context`)
      if (res.ok) {
        const json = await res.json()
        if (json.data) setPublishContext(json.data)
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
    void Promise.all([
      loadClips(),
      loadPrompts(),
      loadStoryboard(),
      loadManifest(),
      loadFailoverLog(),
      loadPublishContext(),
      loadDirectorPlan(),
    ]).then(() => setLoading(false))
  }, [loadClips, loadPrompts, loadStoryboard, loadManifest, loadFailoverLog, loadPublishContext, loadDirectorPlan])

  useEffect(() => {
    if (!storyboard.some((image) => image.cloudPlanStatus === 'queued')) return

    const interval = window.setInterval(() => {
      void loadStoryboard()
    }, 4000)

    return () => window.clearInterval(interval)
  }, [storyboard, loadStoryboard])

  async function savePrompt(sceneIndex: number) {
    const draft = promptDrafts[sceneIndex]
    if (!draft) return
    await fetch(`/api/runs/${id}/prompts`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneIndex, prompt: draft.prompt, negativePrompt: draft.negativePrompt }),
    })
    await Promise.all([loadPrompts(), loadClips()])
  }

  async function handleRegenerate(type: 'storyboard' | 'video', sceneIndex: number) {
    let paidPayload: { confirmPaidGeneration: true; confirmationText: string } | null = null
    if (type === 'video') {
      paidPayload = await collectPaidSceneConfirmation(sceneIndex)
      if (!paidPayload) return
    }

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
        body: JSON.stringify({
          type,
          sceneIndex,
          ...(type === 'video' && promptDrafts[sceneIndex]
            ? {
                prompt: promptDrafts[sceneIndex].prompt,
                negativePrompt: promptDrafts[sceneIndex].negativePrompt,
              }
            : {}),
          ...(paidPayload ?? {}),
        }),
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
        await Promise.all([loadStoryboard(), loadFailoverLog(), loadClips(), loadPrompts()])
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

  async function handlePublish(platform: string) {
    setPublishing(true)
    try {
      await fetch(`/api/runs/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      })
      // Recharger le contexte pour mettre à jour le manifest
      await loadPublishContext()
    } catch { /* silencieux */ }
    finally {
      setPublishing(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Chargement...</p>

  const completedClips = clips.filter(c => c.status === 'completed')
  const realStoryboardImages = storyboard.filter(i => i.status === 'generated' && !i.isPlaceholder)
  const placeholderStoryboardImages = storyboard.filter(i => i.isPlaceholder)
  const hasPlayable = !!(manifest?.playableFilePath)
  const hasClips = completedClips.length > 0
  const hasStoryboard = realStoryboardImages.length > 0
  const mode = manifest?.mode ?? 'none'
  const promptSceneIndexes = Array.from(
    new Set([
      ...storyboard.map((img) => img.sceneIndex),
      ...clips.map((clip) => clip.stepIndex),
      ...Object.keys(promptDrafts).map((key) => Number(key)).filter((value) => Number.isFinite(value)),
    ]),
  ).sort((a, b) => a - b)
  const promptScenes = promptSceneIndexes.map((sceneIndex) => ({
    sceneIndex,
    storyboardImage: storyboard.find((img) => img.sceneIndex === sceneIndex),
    clip: clips.find((clip) => clip.stepIndex === sceneIndex),
  }))

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

      {/* Direction créative */}
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

      <VideoRequestPreflightPanel runId={id} />

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
        </div>
      )}

      {/* Panneau diffusion contextualisé — 13C */}
      {publishContext && (
        <div className="rounded-md border p-3">
          <PublishPanel
            runId={id}
            context={publishContext}
            hasPlayable={hasPlayable}
            onPublish={handlePublish}
            publishing={publishing}
          />
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
            <p className="text-amber-700">{completedClips.length} clip(s) présent(s) — assemblage non encore exécuté (step 9 Preview non atteint).</p>
          ) : placeholderStoryboardImages.length > 0 ? (
            <p className="text-amber-700">Des placeholders locaux ont été produits à la place de vraies images storyboard. Ce storyboard est fake tant qu’une régénération réelle n’a pas réussi.</p>
          ) : hasStoryboard ? (
            <p className="text-amber-700">Storyboard disponible. Pas de clips vidéo (providers non configurés). Aucun animatic assemblé.</p>
          ) : (
            <p className="text-muted-foreground">Aucun artefact visuel disponible. Le pipeline doit atteindre au moins le step 5 (Storyboard).</p>
          )}
        </div>
      )}

      {placeholderStoryboardImages.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          {placeholderStoryboardImages.length} scène(s) storyboard sont en placeholder local. Elles ne doivent pas être prises pour de vraies images : régénère les scènes pour obtenir un storyboard réel.
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
                  <div className="aspect-video bg-muted relative">
                    <span className="absolute top-2 left-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-mono z-10">
                      {img.sceneIndex}
                    </span>
                    {img.isPlaceholder ? (
                      <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-amber-800">
                        Placeholder local — pas une vraie image storyboard
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/runs/${id}/storyboard/image/${img.sceneIndex}?v=${encodeURIComponent(`${storyboardAssetVersion}-${img.cloudPlanAppliedAt || img.filePath}`)}`}
                        alt={`Scène ${img.sceneIndex}`}
                        className="w-full h-full object-contain bg-white"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                  </div>
                  <div className="p-2 space-y-1.5">
                    <p className="text-xs text-muted-foreground line-clamp-2">{img.description}</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant="secondary" className="text-[9px]">
                        {img.isPlaceholder ? 'Placeholder local' : img.status === 'generated' ? 'Généré' : img.status}
                      </Badge>
                      {img.cloudPlanStatus && (
                        <Badge variant={img.cloudPlanStatus === 'failed' ? 'destructive' : 'outline'} className="text-[9px]">
                          {img.cloudPlanStatus === 'queued'
                            ? 'Cloud en cours'
                            : img.cloudPlanAppliedAt
                              ? 'Cloud appliqué'
                              : 'Cloud prêt'}
                        </Badge>
                      )}
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

      {/* Prompts vidéo visibles même sans clip déjà généré */}
      {promptScenes.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Prompts vidéo — {promptScenes.length} scène(s)</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {promptScenes.map(({ sceneIndex, storyboardImage, clip }) => (
              <div key={clip?.id ?? `prompt-${sceneIndex}`} className="rounded-lg border p-3 space-y-3">
                <div className="aspect-video rounded bg-muted flex items-center justify-center">
                  <span className="text-xs font-mono text-muted-foreground">S{sceneIndex}</span>
                </div>
                <Badge
                  variant={clip?.status === 'completed' ? 'default' : clip ? 'destructive' : 'secondary'}
                  className="text-[10px] w-full justify-center"
                >
                  {clip?.status === 'completed'
                    ? 'Clip généré'
                    : clip?.status === 'failed'
                    ? 'Clip en échec'
                    : 'Clip non généré'}
                </Badge>
                {clip?.provider && clip.provider !== 'video' && (
                  <p className="text-[10px] text-muted-foreground text-center">{clip.provider}</p>
                )}
                <p className="text-xs text-muted-foreground line-clamp-4">
                  {storyboardImage?.description ?? 'Aucune description storyboard disponible pour cette scène.'}
                </p>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">Prompt vidéo</p>
                  <textarea
                    value={promptDrafts[sceneIndex]?.prompt ?? clip?.prompt ?? ''}
                    onChange={(e) => setPromptDrafts((prev) => ({
                      ...prev,
                      [sceneIndex]: {
                        prompt: e.target.value,
                        negativePrompt: prev[sceneIndex]?.negativePrompt ?? clip?.negativePrompt ?? '',
                      },
                    }))}
                    className="min-h-32 w-full rounded-md border bg-background px-2 py-2 text-xs"
                  />
                  <p className="text-xs font-medium text-foreground">Negative prompt</p>
                  <textarea
                    value={promptDrafts[sceneIndex]?.negativePrompt ?? clip?.negativePrompt ?? ''}
                    onChange={(e) => setPromptDrafts((prev) => ({
                      ...prev,
                      [sceneIndex]: {
                        prompt: prev[sceneIndex]?.prompt ?? clip?.prompt ?? '',
                        negativePrompt: e.target.value,
                      },
                    }))}
                    placeholder="Negative prompt"
                    className="min-h-24 w-full rounded-md border bg-background px-2 py-2 text-xs text-muted-foreground"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs h-8"
                    onClick={() => savePrompt(sceneIndex)}
                    disabled={!(promptDrafts[sceneIndex]?.prompt ?? clip?.prompt ?? '').trim()}
                  >
                    Sauver prompt
                  </Button>
                </div>
                {regenResult[sceneIndex] && (
                  <Badge
                    variant={regenResult[sceneIndex].ok ? 'default' : 'destructive'}
                    className="text-[10px] w-full justify-center"
                  >
                    {regenResult[sceneIndex].ok
                      ? `✓ ${regenResult[sceneIndex].provider}${regenResult[sceneIndex].failover ? ' (basculé)' : ''}`
                      : `✗ ${regenResult[sceneIndex].error ?? 'Échec'}`}
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-8"
                  onClick={() => handleRegenerate('video', sceneIndex)}
                  disabled={regenerating[sceneIndex] ?? false}
                >
                  {regenerating[sceneIndex] ? '...' : 'Régénérer'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
