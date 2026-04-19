'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'

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

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>()
  const [clips, setClips] = useState<Clip[]>([])
  const [storyboard, setStoryboard] = useState<StoryboardImage[]>([])
  const [loading, setLoading] = useState(true)

  const loadClips = async () => {
    try {
      const res = await fetch(`/api/runs/${id}/clips`)
      const json = await res.json()
      if (json.data) setClips(json.data)
    } catch { /* silencieux */ }
  }

  const loadStoryboard = async () => {
    try {
      const res = await fetch(`/api/runs/${id}/storyboard`)
      const json = await res.json()
      if (json.data?.images) setStoryboard(json.data.images)
    } catch { /* silencieux */ }
  }

  useEffect(() => { // eslint-disable-line react-hooks/exhaustive-deps
    void Promise.all([loadClips(), loadStoryboard()]).then(() => setLoading(false))
  }, [id])

  if (loading) return <p className="text-sm text-muted-foreground">Chargement...</p>

  const completedClips = clips.filter(c => c.status === 'completed')
  const generatedImages = storyboard.filter(i => i.status === 'generated')
  const hasClips = completedClips.length > 0
  const hasStoryboard = generatedImages.length > 0

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Preview</h1>

      {/* État réel du run */}
      <div className="rounded-md border p-3 text-sm">
        {hasClips ? (
          <p className="text-green-700">{completedClips.length} clip(s) vidéo généré(s) — assemblage non encore implémenté</p>
        ) : hasStoryboard ? (
          <p className="text-amber-700">Pas de clips vidéo (providers non configurés). Le storyboard est disponible ci-dessous.</p>
        ) : (
          <p className="text-muted-foreground">Aucun artefact visuel disponible. Le pipeline doit atteindre au moins le step 4 (Storyboard).</p>
        )}
      </div>

      {/* Storyboard comme preview visuelle */}
      {hasStoryboard && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Storyboard — {generatedImages.length} scène(s)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {generatedImages.map((img) => (
              <div key={img.sceneIndex} className="rounded-lg border overflow-hidden">
                <div className="aspect-[9/16] bg-muted relative">
                  <span className="absolute top-2 left-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-mono">
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
                <div className="p-2">
                  <p className="text-xs text-muted-foreground line-clamp-2">{img.description}</p>
                  <Badge variant="secondary" className="text-[9px] mt-1">
                    {img.status === 'generated' ? 'Généré' : img.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline clips si présents */}
      {hasClips && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Clips vidéo — {completedClips.length}</h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {clips.map((clip) => (
              <div
                key={clip.id}
                className="flex-shrink-0 w-28 rounded-lg border p-2"
              >
                <div className="aspect-[9/16] rounded bg-muted flex items-center justify-center mb-1">
                  <span className="text-xs font-mono text-muted-foreground">{clip.stepIndex}</span>
                </div>
                <Badge
                  variant={clip.status === 'completed' ? 'default' : 'destructive'}
                  className="text-[9px] w-full justify-center"
                >
                  {clip.status === 'completed' ? 'OK' : 'Échec'}
                </Badge>
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{clip.prompt}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
