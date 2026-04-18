'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type ExportPreset = {
  name: string
  platform: string
  format: string
  resolution: string
  maxDuration: number
}

type Metadata = {
  description?: string
  hashtags?: string[]
  title_variants?: Record<string, string>
}

export default function ExportPage() {
  const { id } = useParams<{ id: string }>()
  const [presets, setPresets] = useState<ExportPreset[]>([])
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')

  useEffect(() => {
    loadExportData()
  }, [id])

  async function loadExportData() {
    const res = await fetch(`/api/runs/${id}/export`)
    const json = await res.json()
    if (json.data) {
      setPresets(json.data.presets)
      setMetadata(json.data.metadata)
      if (json.data.metadata?.description) {
        setDescriptionDraft(json.data.metadata.description)
      }
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    const res = await fetch(`/api/runs/${id}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'regenerate_metadata' }),
    })
    const json = await res.json()
    if (json.data) {
      setMetadata(json.data)
      if (json.data.description) setDescriptionDraft(json.data.description)
    }
    setRegenerating(false)
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold">Export</h1>

      {/* Presets */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Format d'export</h2>
        <div className="grid grid-cols-2 gap-2">
          {presets.map((p) => (
            <button
              key={p.platform}
              onClick={() => setSelectedPreset(p.platform)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                selectedPreset === p.platform
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <span className="text-sm font-medium">{p.name}</span>
              <div className="text-xs text-muted-foreground mt-0.5">
                {p.resolution} · {p.format} · max {p.maxDuration}s
              </div>
            </button>
          ))}
        </div>
      </div>

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
              {regenerating ? 'Génération...' : 'Régénérer'}
            </Button>
          </div>

          {metadata ? (
            <div className="space-y-2">
              {/* Description */}
              {editingDescription ? (
                <div className="space-y-1">
                  <textarea
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    className="w-full min-h-[60px] rounded-md border bg-transparent px-2 py-1 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-6"
                    onClick={() => setEditingDescription(false)}
                  >
                    Sauver
                  </Button>
                </div>
              ) : (
                <CardDescription
                  className="cursor-pointer hover:text-foreground"
                  onClick={() => setEditingDescription(true)}
                  title="Cliquez pour éditer"
                >
                  {metadata.description || 'Aucune description'}
                </CardDescription>
              )}

              {/* Hashtags */}
              {metadata.hashtags && metadata.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {metadata.hashtags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <CardDescription>
              Pas encore de métadonnées. Cliquez sur Régénérer.
            </CardDescription>
          )}
        </CardHeader>
      </Card>

      {/* Bouton export */}
      <Button disabled={!selectedPreset}>
        Exporter {selectedPreset ? `(${presets.find((p) => p.platform === selectedPreset)?.name})` : ''}
      </Button>
    </div>
  )
}
