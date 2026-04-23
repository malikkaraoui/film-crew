'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Clip = {
  id: string
  stepIndex: number
  prompt: string
  negativePrompt?: string | null
  provider: string
  status: string
}

type StoryboardImage = {
  sceneIndex: number
  description: string
  filePath: string
  status: 'pending' | 'generated' | 'validated' | 'rejected'
  isPlaceholder?: boolean
  cloudPlanStatus?: 'queued' | 'ready' | 'failed' | null
  cloudPlanAppliedAt?: string | null
}

type DirectorPlan = {
  tone: string
  style: string
  creativeDirection: string
}

type PromptApiEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt?: string
}

type PromptDraft = {
  prompt: string
  negativePrompt: string
}

function shortText(value: string | null | undefined, max = 160) {
  const text = value?.trim() ?? ''
  if (!text) return '—'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export default function PromptsPage() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [storyboard, setStoryboard] = useState<StoryboardImage[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [promptDrafts, setPromptDrafts] = useState<Record<number, PromptDraft>>({})
  const [directorPlan, setDirectorPlan] = useState<DirectorPlan | null>(null)
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({})
  const [notices, setNotices] = useState<Record<number, { tone: 'success' | 'error'; message: string }>>({})
  const [storyboardAssetVersion, setStoryboardAssetVersion] = useState('0')

  const loadStoryboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/storyboard`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data?.images) setStoryboard(json.data.images)
    } catch {
      setStoryboard([])
    }
    setStoryboardAssetVersion(`${Date.now()}`)
  }, [id])

  const loadClips = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/clips`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data) setClips(json.data)
    } catch {
      setClips([])
    }
  }, [id])

  const loadPrompts = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/prompts`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data?.prompts) {
        setPromptDrafts(
          Object.fromEntries(
            (json.data.prompts as PromptApiEntry[]).map((entry) => [
              entry.sceneIndex,
              {
                prompt: entry.prompt,
                negativePrompt: entry.negativePrompt ?? '',
              },
            ]),
          ),
        )
      }
    } catch {
      setPromptDrafts({})
    }
  }, [id])

  const loadDirectorPlan = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}/director-plan`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data) setDirectorPlan(json.data as DirectorPlan)
    } catch {
      setDirectorPlan(null)
    }
  }, [id])

  useEffect(() => {
    void Promise.all([loadStoryboard(), loadClips(), loadPrompts(), loadDirectorPlan()]).then(() => setLoading(false))
  }, [loadStoryboard, loadClips, loadPrompts, loadDirectorPlan])

  useEffect(() => {
    if (!storyboard.some((image) => image.cloudPlanStatus === 'queued')) return

    const interval = window.setInterval(() => {
      void loadStoryboard()
    }, 4000)

    return () => window.clearInterval(interval)
  }, [storyboard, loadStoryboard])

  async function savePrompt(sceneIndex: number) {
    const draft = promptDrafts[sceneIndex]
    if (!draft?.prompt.trim()) return

    setSaving((prev) => ({ ...prev, [sceneIndex]: true }))
    setNotices((prev) => ({ ...prev, [sceneIndex]: { tone: 'success', message: '' } }))

    try {
      const res = await fetch(`/api/runs/${id}/prompts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneIndex,
          prompt: draft.prompt,
          negativePrompt: draft.negativePrompt,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setNotices((prev) => ({ ...prev, [sceneIndex]: { tone: 'error', message: json.error?.message ?? 'Sauvegarde impossible' } }))
        return
      }
      setNotices((prev) => ({ ...prev, [sceneIndex]: { tone: 'success', message: 'Prompt sauvegardé' } }))
      await loadPrompts()
    } catch {
      setNotices((prev) => ({ ...prev, [sceneIndex]: { tone: 'error', message: 'Erreur réseau' } }))
    } finally {
      setSaving((prev) => ({ ...prev, [sceneIndex]: false }))
    }
  }

  async function handleRegenerate(sceneIndex: number) {
    const draft = promptDrafts[sceneIndex]
    setRegenerating((prev) => ({ ...prev, [sceneIndex]: true }))
    setNotices((prev) => ({ ...prev, [sceneIndex]: { tone: 'success', message: '' } }))

    try {
      const res = await fetch(`/api/runs/${id}/regenerate-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'video',
          sceneIndex,
          prompt: draft?.prompt,
          negativePrompt: draft?.negativePrompt,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setNotices((prev) => ({ ...prev, [sceneIndex]: { tone: 'error', message: json.error?.message ?? 'Régénération impossible' } }))
        return
      }
      setNotices((prev) => ({
        ...prev,
        [sceneIndex]: { tone: 'success', message: `Clip relancé via ${json.data?.providerUsed ?? 'provider'}` },
      }))
      await Promise.all([loadClips(), loadPrompts()])
    } catch {
      setNotices((prev) => ({ ...prev, [sceneIndex]: { tone: 'error', message: 'Erreur réseau' } }))
    } finally {
      setRegenerating((prev) => ({ ...prev, [sceneIndex]: false }))
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Chargement...</p>

  const sceneIndexes = Array.from(
    new Set([
      ...storyboard.map((img) => img.sceneIndex),
      ...clips.map((clip) => clip.stepIndex),
      ...Object.keys(promptDrafts).map((key) => Number(key)).filter((value) => Number.isFinite(value)),
    ]),
  ).sort((a, b) => a - b)

  const promptScenes = sceneIndexes.map((sceneIndex) => ({
    sceneIndex,
    storyboardImage: storyboard.find((img) => img.sceneIndex === sceneIndex),
    clip: clips.find((clip) => clip.stepIndex === sceneIndex),
    draft: promptDrafts[sceneIndex] ?? { prompt: '', negativePrompt: '' },
  }))

  const placeholderCount = storyboard.filter((img) => img.isPlaceholder).length
  const realStoryboardCount = storyboard.filter((img) => !img.isPlaceholder).length
  const completedClipCount = clips.filter((clip) => clip.status === 'completed').length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Prompts vidéo</h1>
        <Badge variant="outline">{promptScenes.length} scène(s)</Badge>
        <Badge variant={completedClipCount > 0 ? 'default' : 'outline'}>{completedClipCount} clip(s) généré(s)</Badge>
      </div>

      {directorPlan && (
        <Card size="sm" className="border-violet-200 bg-violet-50/40">
          <CardHeader>
            <CardTitle>Direction créative</CardTitle>
            <CardDescription>
              {directorPlan.tone} · {directorPlan.style}
            </CardDescription>
          </CardHeader>
          {directorPlan.creativeDirection && (
            <CardContent>
              <p className="text-sm text-violet-900/80">{directorPlan.creativeDirection}</p>
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Storyboard réel</CardTitle>
            <CardDescription>{realStoryboardCount} scène(s) avec vraie vignette</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Placeholders</CardTitle>
            <CardDescription>{placeholderCount} scène(s) de référence faibles</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Objectif ici</CardTitle>
            <CardDescription>Éditer les prompts, pas juger la preview</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {promptScenes.map(({ sceneIndex, storyboardImage, clip, draft }) => {
          const notice = notices[sceneIndex]
          const isPlaceholder = Boolean(storyboardImage?.isPlaceholder)
          const clipStatus = clip?.status ?? 'not-generated'

          return (
            <Card key={clip?.id ?? `prompt-${sceneIndex}`}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Scène {sceneIndex}</CardTitle>
                    <CardDescription>{shortText(storyboardImage?.description ?? 'Aucune description storyboard disponible.', 220)}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={isPlaceholder ? 'destructive' : storyboardImage ? 'secondary' : 'outline'}>
                      {isPlaceholder ? 'réf. faible' : storyboardImage ? 'réf. storyboard' : 'sans image'}
                    </Badge>
                    <Badge variant={clipStatus === 'completed' ? 'default' : clipStatus === 'failed' ? 'destructive' : 'outline'}>
                      {clipStatus === 'completed' ? 'clip généré' : clipStatus === 'failed' ? 'clip en échec' : 'clip non généré'}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="overflow-hidden rounded-lg border bg-muted/20">
                    <div className="aspect-video bg-muted flex items-center justify-center">
                      {storyboardImage && !isPlaceholder ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/runs/${id}/storyboard/image/${sceneIndex}?v=${encodeURIComponent(`${storyboardAssetVersion}-${storyboardImage.cloudPlanAppliedAt || storyboardImage.filePath}`)}`}
                          alt={`Scène ${sceneIndex}`}
                          className="h-full w-full object-contain bg-white"
                        />
                      ) : (
                        <div className="px-3 text-center text-xs text-muted-foreground">
                          {isPlaceholder ? 'Placeholder local' : 'Aucune image'}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Prompt vidéo</label>
                      <textarea
                        value={draft.prompt}
                        onChange={(e) => setPromptDrafts((prev) => ({
                          ...prev,
                          [sceneIndex]: {
                            prompt: e.target.value,
                            negativePrompt: prev[sceneIndex]?.negativePrompt ?? draft.negativePrompt,
                          },
                        }))}
                        className="min-h-36 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Negative prompt</label>
                      <textarea
                        value={draft.negativePrompt}
                        onChange={(e) => setPromptDrafts((prev) => ({
                          ...prev,
                          [sceneIndex]: {
                            prompt: prev[sceneIndex]?.prompt ?? draft.prompt,
                            negativePrompt: e.target.value,
                          },
                        }))}
                        className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                        placeholder="Ce qu’il faut éviter"
                      />
                    </div>

                    {notice?.message && (
                      <div className={`rounded-md border px-3 py-2 text-xs ${notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                        {notice.message}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => savePrompt(sceneIndex)}
                        disabled={saving[sceneIndex] || !draft.prompt.trim()}
                      >
                        {saving[sceneIndex] ? 'Sauvegarde...' : 'Sauver prompt'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleRegenerate(sceneIndex)}
                        disabled={regenerating[sceneIndex] || !draft.prompt.trim()}
                      >
                        {regenerating[sceneIndex] ? 'Relance...' : 'Tester ce prompt'}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}