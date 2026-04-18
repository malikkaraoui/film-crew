'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { RunStepper } from '@/components/stepper/run-stepper'
import { Button } from '@/components/ui/button'
import type { Run, RunStep } from '@/types/run'

type RunWithSteps = Run & { steps: RunStep[] }

export default function RunPage() {
  const { id } = useParams<{ id: string }>()
  const [run, setRun] = useState<RunWithSteps | null>(null)

  useEffect(() => {
    loadRun()
    const interval = setInterval(loadRun, 3000) // polling 2-3s
    return () => clearInterval(interval)
  }, [id])

  async function loadRun() {
    const res = await fetch(`/api/runs/${id}`)
    const json = await res.json()
    if (json.data) setRun(json.data)
  }

  async function handleStepBack(stepNumber: number) {
    if (!confirm(`Revenir à l'étape ${stepNumber} ?`)) return
    await fetch(`/api/runs/${id}/step-back`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetStep: stepNumber }),
    })
    loadRun()
  }

  if (!run) return <p className="text-sm text-muted-foreground">Chargement...</p>

  const currentStep = run.currentStep ?? 1

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold truncate max-w-md">{run.idea}</h1>
        {run.status === 'running' && (
          <Button variant="destructive" size="sm">
            Arrêter
          </Button>
        )}
      </div>

      <div className="mt-4">
        <RunStepper steps={run.steps} currentStep={currentStep} onStepClick={handleStepBack} />
      </div>

      <div className="mt-6 rounded-md border p-4">
        <h2 className="text-lg font-semibold">
          Étape {currentStep} — {run.steps.find((s) => s.stepNumber === currentStep)?.stepName}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Contenu de l'étape — à implémenter dans les Epics suivants
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span>Coût : {(run.costEur ?? 0).toFixed(2)} €</span>
        <span>Statut : {run.status}</span>
        <Link href={`/runs/${id}/studio`} className="text-primary hover:underline">
          Réunion
        </Link>
        <Link href={`/runs/${id}/storyboard`} className="text-primary hover:underline">
          Storyboard
        </Link>
        <Link href={`/runs/${id}/preview`} className="text-primary hover:underline">
          Preview
        </Link>
        <Link href={`/runs/${id}/localize`} className="text-primary hover:underline">
          Localiser
        </Link>
        <Link href={`/runs/${id}/export`} className="text-primary hover:underline">
          Exporter
        </Link>
      </div>
    </div>
  )
}
