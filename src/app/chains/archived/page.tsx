'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  const [purging, setPurging] = useState<string | null>(null)
  const [confirmInputs, setConfirmInputs] = useState<Record<string, string>>({})
  const [confirmOpen, setConfirmOpen] = useState<string | null>(null)
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

  useEffect(() => { void loadChains() }, [])

  async function handleRestore(id: string) {
    setRestoring(id)
    setError('')
    try {
      const res = await fetch(`/api/chains/${id}/restore`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setError(json.error?.message ?? 'Restauration impossible'); return }
      await loadChains()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRestoring(null)
    }
  }

  async function handlePurge(id: string, name: string) {
    const confirm = confirmInputs[id] ?? ''
    if (confirm.trim() !== name.trim()) {
      setError(`Confirmation invalide — saisir exactement : ${name}`)
      return
    }
    setPurging(id)
    setError('')
    try {
      const res = await fetch(`/api/chains/${id}/hard`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error?.message ?? 'Suppression impossible'); return }
      setConfirmOpen(null)
      setConfirmInputs((prev) => { const next = { ...prev }; delete next[id]; return next })
      await loadChains()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPurging(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Chaînes archivées</h1>
          <p className="text-sm text-muted-foreground">
            Ces chaînes ne sont plus visibles dans la liste principale. Tu peux les restaurer ou les supprimer définitivement.
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
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleRestore(c.id)}
                    disabled={restoring === c.id || purging === c.id}
                  >
                    {restoring === c.id ? 'Restauration...' : 'Restaurer'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmOpen(confirmOpen === c.id ? null : c.id)}
                    disabled={restoring === c.id || purging === c.id}
                  >
                    Supprimer définitivement
                  </Button>
                </div>
              </CardHeader>

              {confirmOpen === c.id && (
                <CardContent className="space-y-2 border-t pt-3">
                  <p className="text-xs text-destructive">
                    Cette action est irréversible. Tous les runs, fichiers audio et logs seront supprimés.
                    Saisir le nom exact pour confirmer :
                    <span className="ml-1 font-mono font-semibold">{c.name}</span>
                  </p>
                  <div className="flex gap-2">
                    <Input
                      className="h-7 text-xs"
                      placeholder={c.name}
                      value={confirmInputs[c.id] ?? ''}
                      onChange={(e) =>
                        setConfirmInputs((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                    />
                    <Button
                      variant="destructive"
                      onClick={() => handlePurge(c.id, c.name)}
                      disabled={purging === c.id || (confirmInputs[c.id] ?? '').trim() !== c.name.trim()}
                    >
                      {purging === c.id ? 'Suppression...' : 'Confirmer'}
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
