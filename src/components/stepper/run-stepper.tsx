'use client'

import type { RunStep } from '@/types/run'

const STEP_LABELS = [
  'Idée',
  'Brainstorm',
  'JSON',
  'Blueprint',
  'Storyboard',
  'Prompts',
  'Génération',
  'Preview',
  'Publication',
]

type Props = {
  steps: RunStep[]
  currentStep: number
  onStepClick?: (stepNumber: number) => void
}

export function RunStepper({ steps, currentStep, onStepClick }: Props) {
  return (
    <div className="flex items-center gap-1">
      {STEP_LABELS.map((label, i) => {
        const stepNum = i + 1
        const step = steps.find((s) => s.stepNumber === stepNum)
        const status = step?.status ?? 'pending'
        const isCurrent = stepNum === currentStep
        const isPast = stepNum < currentStep
        const canClick = isPast && onStepClick

        return (
          <button
            key={stepNum}
            onClick={() => canClick && onStepClick(stepNum)}
            disabled={!canClick}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
              isCurrent
                ? 'bg-primary text-primary-foreground font-medium'
                : isPast
                  ? 'bg-accent text-accent-foreground cursor-pointer hover:bg-accent/80'
                  : 'text-muted-foreground'
            } ${!canClick && !isCurrent ? 'cursor-default' : ''}`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[10px]">
              {status === 'completed' ? '✓' : stepNum}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
