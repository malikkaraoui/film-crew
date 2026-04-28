'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateChainDialog } from '@/components/brand-kit/create-chain-dialog'
import Link from 'next/link'
import type { Chain } from '@/types/chain'
import type { Run } from '@/types/run'
import { getCurrentProject, getProjectStatusClass, getProjectStatusLabel, getRunStepLabel } from '@/lib/runs/presentation'

export default function ChainsPage() {
  const [chains, setChains] = useState<Chain[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [open, setOpen] = useState(false)

  async function loadChains() {
    const res = await fetch('/api/chains')
    const json = await res.json()
    if (json.data) setChains(json.data)
  }

  useEffect(() => {
    void loadChains()
    fetch('/api/runs')
      .then((r) => r.json())
      .then((json) => { if (json.data) setRuns(json.data) })
  }, [])

  async function handleCreate(data: { name: string; langSource: string; audience?: string }) {
    const res = await fetch('/api/chains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      setOpen(false)
      loadChains()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Chaînes</h1>
          <p className="text-sm text-muted-foreground">
            Ici tu vois seulement tes chaînes. Tu entres dans une chaîne pour gérer ses projets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/chains/archived">
            <Button variant="outline">Voir les archives</Button>
          </Link>
          <Button onClick={() => setOpen(true)}>Nouvelle chaîne</Button>
        </div>
      </div>

      {chains.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aucune chaîne. Créez-en une pour commencer.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {chains.map((c) => {
            const chainRuns = runs.filter((run) => run.chainId === c.id)
            const currentProject = getCurrentProject(chainRuns)
            return (
              <Link key={c.id} href={`/chains/${c.id}`} className="block">
                <Card className="transition hover:bg-accent/20">
                  <CardHeader className="flex flex-row items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">{c.name}</CardTitle>
                      <CardDescription className="flex flex-wrap items-center gap-3 text-xs">
                        <span>{c.langSource.toUpperCase()}{c.audience && ` · ${c.audience}`}</span>
                        <span>{chainRuns.length} projet(s)</span>
                      </CardDescription>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      {currentProject ? (
                        <div className={`font-medium ${getProjectStatusClass(currentProject.status)}`}>
                          {getProjectStatusLabel(currentProject)}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">Aucun projet en cours</div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {currentProject
                        ? `Projet courant : ${getRunStepLabel(currentProject)}`
                        : 'Prête pour un nouveau projet'}
                    </span>
                    <span>Cliquer pour entrer dans la chaîne</span>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <CreateChainDialog open={open} onOpenChange={setOpen} onCreate={handleCreate} />
    </div>
  )
}
