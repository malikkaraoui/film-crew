'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type StoryboardImage = {
  sceneIndex: number
  description: string
  filePath: string
  status: 'pending' | 'generated' | 'validated' | 'rejected'
}

type Props = {
  images: StoryboardImage[]
  onValidate: (sceneIndex: number) => void
  onReject: (sceneIndex: number) => void
  onValidateAll: () => void
  onEditDescription: (sceneIndex: number, description: string) => void
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'En attente', variant: 'outline' },
  generated: { label: 'Généré', variant: 'secondary' },
  validated: { label: 'Validé', variant: 'default' },
  rejected: { label: 'À refaire', variant: 'destructive' },
}

export function StoryboardGrid({ images, onValidate, onReject, onValidateAll, onEditDescription }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  function startEdit(img: StoryboardImage) {
    setEditingIndex(img.sceneIndex)
    setEditText(img.description)
  }

  function saveEdit(sceneIndex: number) {
    onEditDescription(sceneIndex, editText)
    setEditingIndex(null)
  }

  if (images.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Aucune image de storyboard. Lancez l&apos;étape 4 pour les générer.
      </p>
    )
  }

  const rejectedCount = images.filter((i) => i.status === 'rejected').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Storyboard</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onValidateAll}>
            Valider tout
          </Button>
          {rejectedCount > 0 && (
            <Button size="sm" disabled title="Régénération non implémentée (Lot 5)">
              Régénérer la sélection ({rejectedCount})
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {images.map((img) => {
          const badge = STATUS_BADGE[img.status] ?? STATUS_BADGE.pending
          const isEditing = editingIndex === img.sceneIndex

          return (
            <div
              key={img.sceneIndex}
              className="rounded-lg border overflow-hidden"
            >
              {/* Vignette — placeholder ou image */}
              <div className="aspect-[9/16] bg-muted flex items-center justify-center relative">
                <span className="absolute top-2 left-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-mono">
                  {img.sceneIndex}
                </span>
                {img.filePath.endsWith('.txt') ? (
                  <span className="text-xs text-muted-foreground px-4 text-center">
                    Image en attente
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/storage/${encodeURIComponent(img.filePath)}`}
                    alt={`Scène ${img.sceneIndex}`}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>

              {/* Description */}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>

                {isEditing ? (
                  <div className="space-y-1">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full min-h-[60px] rounded-md border bg-transparent px-2 py-1 text-xs"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="text-xs h-6" onClick={() => saveEdit(img.sceneIndex)}>
                        Sauver
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => setEditingIndex(null)}>
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-xs text-muted-foreground cursor-pointer hover:text-foreground"
                    onDoubleClick={() => startEdit(img)}
                    title="Double-cliquez pour éditer"
                  >
                    {img.description}
                  </p>
                )}

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-6 flex-1"
                    onClick={() => onValidate(img.sceneIndex)}
                    disabled={img.status === 'validated'}
                  >
                    Valider
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-6 flex-1 text-destructive"
                    onClick={() => onReject(img.sceneIndex)}
                    disabled={img.status === 'rejected'}
                  >
                    Rejeter
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
