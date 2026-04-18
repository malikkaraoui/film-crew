'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ClipTimeline } from '@/components/preview/clip-timeline'

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

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>()
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClips()
  }, [id])

  async function loadClips() {
    try {
      const res = await fetch(`/api/runs/${id}/clips`)
      const json = await res.json()
      if (json.data) setClips(json.data)
    } catch { /* silencieux */ }
    setLoading(false)
  }

  // Régénération non implémentée (Lot 5)
  function handleRegenerate(_clipId: string) { /* non implémenté */ }

  if (loading) return <p className="text-sm text-muted-foreground">Chargement...</p>

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Preview</h1>

      <div className="aspect-[9/16] max-w-sm mx-auto rounded-lg bg-muted flex items-center justify-center">
        <p className="text-sm text-muted-foreground text-center px-4">
          {clips.length > 0
            ? `${clips.length} clip(s) généré(s) — assemblage non implémenté`
            : 'Aucun clip généré'}
        </p>
      </div>

      {/* Timeline des clips */}
      <ClipTimeline
        clips={clips}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onRegenerate={handleRegenerate}
      />
    </div>
  )
}
