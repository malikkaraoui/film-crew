'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type StoryboardImage = {
  sceneIndex: number
  description: string
  prompt?: string
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

type Props = {
  runId: string
  images: StoryboardImage[]
  boardFilePath?: string | null
  boardLayout?: string | null
  assetVersion?: string
  onValidate: (sceneIndex: number) => void
  onReject: (sceneIndex: number) => void
  onValidateAll: () => void
  onEditDescription: (sceneIndex: number, description: string) => void
  onEditPrompt: (sceneIndex: number, prompt: string) => void
  onRegenerate: (sceneIndex: number, prompt?: string) => void
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'En attente', variant: 'outline' },
  generated: { label: 'Généré', variant: 'secondary' },
  validated: { label: 'Validé', variant: 'default' },
  rejected: { label: 'À refaire', variant: 'destructive' },
}

const CLOUD_PLAN_BADGE: Record<'queued' | 'ready' | 'failed', { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  queued: { label: 'Cloud en cours', variant: 'outline' },
  ready: { label: 'Plan cloud prêt', variant: 'secondary' },
  failed: { label: 'Cloud échoué', variant: 'destructive' },
}

export function StoryboardGrid({ runId, images, boardFilePath, boardLayout, assetVersion, onValidate, onReject, onValidateAll, onEditDescription, onEditPrompt, onRegenerate }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [promptDrafts, setPromptDrafts] = useState<Record<number, string>>({})

  function startEdit(img: StoryboardImage) {
    setEditingIndex(img.sceneIndex)
    setEditText(img.description)
  }

  function saveEdit(sceneIndex: number) {
    onEditDescription(sceneIndex, editText)
    setEditingIndex(null)
  }

  function getPromptDraft(img: StoryboardImage): string {
    return promptDrafts[img.sceneIndex] ?? img.prompt ?? img.description
  }

  if (images.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Aucune image de storyboard. Lancez l&apos;étape 5 (Storyboard) pour les générer.
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

      {images.some((img) => img.isPlaceholder || img.filePath.includes('placeholder-')) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Certaines vignettes storyboard sont des placeholders locaux. Ce ne sont pas de vraies images générées : les providers image ont échoué et il faut régénérer ces scènes pour obtenir un vrai storyboard.
        </div>
      )}

      {boardFilePath && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Planche storyboard</h3>
            {boardLayout && <Badge variant="outline">{boardLayout}</Badge>}
          </div>
          <div className="overflow-hidden rounded-md border bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/runs/${runId}/storyboard/board?v=${encodeURIComponent(assetVersion || '0')}`}
              alt="Planche storyboard"
              className="h-auto w-full object-contain"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {images.map((img) => {
          const badge = STATUS_BADGE[img.status] ?? STATUS_BADGE.pending
          const isEditing = editingIndex === img.sceneIndex
          const isPlaceholder = img.isPlaceholder || img.filePath.includes('placeholder-') || img.filePath.endsWith('.txt')

          return (
            <div
              key={img.sceneIndex}
              className="rounded-lg border overflow-hidden"
            >
              <div className="aspect-video bg-muted flex items-center justify-center relative">
                <span className="absolute top-2 left-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-mono">
                  {img.sceneIndex}
                </span>
                {isPlaceholder ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      Placeholder local
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Pas une vraie image storyboard. Les providers image ont échoué.
                    </span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/runs/${runId}/storyboard/image/${img.sceneIndex}?v=${encodeURIComponent(`${assetVersion || '0'}-${img.cloudPlanAppliedAt || img.filePath}`)}`}
                    alt={`Scène ${img.sceneIndex}`}
                    className="w-full h-full object-contain bg-white"
                  />
                )}
              </div>

              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {img.cloudPlanStatus && CLOUD_PLAN_BADGE[img.cloudPlanStatus] && (
                      <Badge variant={CLOUD_PLAN_BADGE[img.cloudPlanStatus].variant}>
                        {CLOUD_PLAN_BADGE[img.cloudPlanStatus].label}
                      </Badge>
                    )}
                    {isPlaceholder && (
                      <Badge variant="destructive">fake / placeholder</Badge>
                    )}
                  </div>
                </div>

                {img.cloudPlanStatus && img.cloudPlanModel && (
                  <p className="text-[10px] text-muted-foreground">
                    {img.cloudPlanStatus === 'queued'
                      ? `Ollama ${img.cloudPlanModel} tourne en arrière-plan (${img.cloudPlanMode || 'cloud'}).`
                      : img.cloudPlanStatus === 'ready'
                        ? img.cloudPlanAppliedAt
                          ? `Plan cloud appliqué au rough via ${img.cloudPlanModel} (${img.cloudPlanMode || 'cloud'}).`
                          : `Plan de dessin JSON prêt via ${img.cloudPlanModel} (${img.cloudPlanMode || 'cloud'}).`
                        : `Le passage cloud ${img.cloudPlanModel} a échoué.`}
                  </p>
                )}

                {isPlaceholder && (
                  <p className="text-[10px] text-amber-700">
                    Cette scène n’a pas de vraie vignette. Clique sur régénérer avec un provider image réel.
                  </p>
                )}

                {isEditing ? (
                  <div className="space-y-1">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full min-h-15 rounded-md border bg-transparent px-2 py-1 text-xs"
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

                <div className="space-y-1 rounded-md border bg-muted/30 p-2">
                  <div className="text-[10px] font-medium text-foreground">Prompt storyboard</div>
                  <textarea
                    value={getPromptDraft(img)}
                    onChange={(e) => setPromptDrafts((prev) => ({ ...prev, [img.sceneIndex]: e.target.value }))}
                    className="w-full min-h-24 rounded-md border bg-background px-2 py-1 text-[11px]"
                  />
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-6 flex-1"
                      onClick={() => onEditPrompt(img.sceneIndex, getPromptDraft(img))}
                    >
                      Sauver prompt
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-6 flex-1"
                      onClick={() => onRegenerate(img.sceneIndex, getPromptDraft(img))}
                    >
                      Régénérer avec ce prompt
                    </Button>
                  </div>
                </div>

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-6 flex-1"
                    onClick={() => onValidate(img.sceneIndex)}
                    disabled={img.status === 'validated' || isPlaceholder}
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
