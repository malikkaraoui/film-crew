'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

type ProviderInfo = {
  name: string
  type: string
  health: {
    status: 'free' | 'busy' | 'killing' | 'down' | 'degraded'
    lastCheck: string
    details?: string
  }
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  free: { label: 'Libre', variant: 'default' },
  busy: { label: 'Occupé', variant: 'secondary' },
  killing: { label: 'Arrêt en cours', variant: 'secondary' },
  down: { label: 'Indisponible', variant: 'destructive' },
  degraded: { label: 'Dégradé', variant: 'outline' },
}

type TestState = { status: 'idle' } | { status: 'testing' } | { status: 'done'; result: string; ok: boolean }

export default function ServicesPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})

  async function loadProviders() {
    const res = await fetch('/api/providers')
    const json = await res.json()
    if (json.data) setProviders(json.data)
    setLoading(false)
  }

  useEffect(() => {
    void loadProviders()
    const interval = setInterval(() => void loadProviders(), 60_000)
    return () => clearInterval(interval)
  }, [])

  async function handleTest(name: string) {
    setTestStates(prev => ({ ...prev, [name]: { status: 'testing' } }))
    try {
      const res = await fetch(`/api/providers/${name}/test`, { method: 'POST' })
      const json = await res.json()
      if (json.data?.health) {
        const h = json.data.health
        const ok = h.status === 'free' || h.status === 'busy'
        const label = STATUS_LABELS[h.status]?.label ?? h.status
        setTestStates(prev => ({ ...prev, [name]: { status: 'done', result: label + (h.details ? ` — ${h.details}` : ''), ok } }))
      } else {
        setTestStates(prev => ({ ...prev, [name]: { status: 'done', result: json.error?.message ?? 'Erreur inconnue', ok: false } }))
      }
      void loadProviders()
    } catch (e) {
      setTestStates(prev => ({ ...prev, [name]: { status: 'done', result: (e as Error).message, ok: false } }))
    }
    setTimeout(() => setTestStates(prev => ({ ...prev, [name]: { status: 'idle' } })), 5000)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Services & Connexions</h1>
        <Button variant="outline" size="sm" onClick={loadProviders}>
          Rafraîchir
        </Button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Chargement...</p>
      ) : providers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aucun service enregistré. Les providers seront disponibles au fur et à mesure de la configuration.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {providers.map((p) => {
            const statusInfo = STATUS_LABELS[p.health.status] ?? STATUS_LABELS.down
            return (
              <Card key={p.name}>
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <CardDescription className="text-xs">{p.type}</CardDescription>
                    </div>
                    <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  </div>
                  {(() => {
                    const ts = testStates[p.name] ?? { status: 'idle' }
                    if (ts.status === 'testing') {
                      return <Button variant="ghost" size="sm" disabled className="min-w-[120px] text-xs animate-pulse">Test en cours...</Button>
                    }
                    if (ts.status === 'done') {
                      return (
                        <span className={`text-xs font-medium px-2 py-1 rounded ${ts.ok ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                          {ts.ok ? '\u2705' : '\u274C'} {ts.result}
                        </span>
                      )
                    }
                    return <Button variant="ghost" size="sm" className="min-w-[120px]" onClick={() => handleTest(p.name)}>Tester</Button>
                  })()}
                </CardHeader>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
