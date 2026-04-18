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

export default function ServicesPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(true)

  async function loadProviders() {
    const res = await fetch('/api/providers')
    const json = await res.json()
    if (json.data) setProviders(json.data)
    setLoading(false)
  }

  useEffect(() => {
    loadProviders()
    const interval = setInterval(loadProviders, 60_000) // polling 60s
    return () => clearInterval(interval)
  }, [])

  async function handleTest(name: string) {
    const res = await fetch(`/api/providers/${name}/test`, { method: 'POST' })
    const json = await res.json()
    if (json.data) {
      loadProviders()
    }
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
                  <Button variant="ghost" size="sm" onClick={() => handleTest(p.name)}>
                    Tester
                  </Button>
                </CardHeader>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
