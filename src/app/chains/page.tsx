'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CreateChainDialog } from '@/components/brand-kit/create-chain-dialog'
import Link from 'next/link'
import type { Chain } from '@/types/chain'

export default function ChainsPage() {
  const [chains, setChains] = useState<Chain[]>([])
  const [open, setOpen] = useState(false)

  async function loadChains() {
    const res = await fetch('/api/chains')
    const json = await res.json()
    if (json.data) setChains(json.data)
  }

  useEffect(() => { void loadChains() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cette chaîne et tous ses fichiers ?')) return
    await fetch(`/api/chains/${id}`, { method: 'DELETE' })
    loadChains()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Chaînes</h1>
        <Button onClick={() => setOpen(true)}>Nouvelle chaîne</Button>
      </div>

      {chains.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aucune chaîne. Créez-en une pour commencer.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {chains.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div>
                  <CardTitle className="text-base">
                    <Link href={`/chains/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {c.langSource.toUpperCase()} {c.audience && `· ${c.audience}`}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)} className="text-destructive">
                  Supprimer
                </Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <CreateChainDialog open={open} onOpenChange={setOpen} onCreate={handleCreate} />
    </div>
  )
}
