'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Chain } from '@/types/chain'

function formatDate(value: Date | string | null): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function ArchivedChainsPage() {
  const [chains, setChains] = useState<Chain[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function loadChains() {
    setLoading(true)
    try {
      const res = await fetch('/api/chains?archived=1')
      const json = await res.json()
      if (json.data) setChains(json.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadChains()
  }, [])

  async function handleRestore(id: string) {
    setRestoring(id)
    setError('')
    try {
      const res = await fetch(`/api/chains/${id}/restore`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error?.message ?? 'Restauration impossible')
        return
      }
      await loadChains()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Chaînes archivées</h1>
          <p className="text-sm text-muted-foreground">
            Ces chaînes ne sont plus visibles dans la liste principale. Tu peux les restaurer à tout moment.
          </p>
        </div>
        <Link href="/chains">
          <Button variant="outline">Retour aux chaînes</Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : chains.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune chaîne archivée.</p>
      ) : (
        <div className="grid gap-3">
          {chains.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">{c.name || '(sans nom)'}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-3 text-xs">
                    <span>{c.langSource.toUpperCase()}{c.audience && ` · ${c.audience}`}</span>
                    <span>Archivée le {formatDate(c.archivedAt)}</span>
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  onClick={() => handleRestore(c.id)}
                  disabled={restoring === c.id}
                >
                  {restoring === c.id ? 'Restauration...' : 'Restaurer'}
                </Button>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Les runs et le storage sont conservés. Restaurer la rendra à nouveau visible et utilisable.
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
