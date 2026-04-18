'use client'

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

type Props = {
  clips: Clip[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  onRegenerate: (clipId: string) => void
}

export function ClipTimeline({ clips, selectedIndex, onSelect, onRegenerate }: Props) {
  if (clips.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">Aucun clip généré.</p>
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Timeline — {clips.length} clips</h3>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {clips.map((clip) => {
          const isSelected = selectedIndex === clip.stepIndex
          const isCompleted = clip.status === 'completed'

          return (
            <button
              key={clip.id}
              onClick={() => onSelect(clip.stepIndex)}
              className={`flex-shrink-0 w-24 rounded-lg border p-2 text-left transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="aspect-[9/16] rounded bg-muted flex items-center justify-center mb-1">
                <span className="text-xs font-mono text-muted-foreground">
                  {clip.stepIndex}
                </span>
              </div>
              <Badge
                variant={isCompleted ? 'default' : 'destructive'}
                className="text-[9px] w-full justify-center"
              >
                {isCompleted ? 'OK' : 'Échec'}
              </Badge>
            </button>
          )
        })}
      </div>

      {selectedIndex !== null && (
        <ClipDetail
          clip={clips.find((c) => c.stepIndex === selectedIndex)!}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  )
}

function ClipDetail({ clip, onRegenerate }: { clip: Clip; onRegenerate: (id: string) => void }) {
  if (!clip) return null

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Clip {clip.stepIndex}</span>
        <div className="flex gap-2">
          {clip.seed != null && (
            <span className="text-[10px] text-muted-foreground font-mono">seed: {clip.seed}</span>
          )}
          {clip.costEur != null && (
            <span className="text-[10px] text-muted-foreground">{clip.costEur.toFixed(3)} €</span>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{clip.prompt}</p>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="text-xs" disabled title="Régénération non implémentée (Lot 5)">
          Régénérer
        </Button>
      </div>
    </div>
  )
}
