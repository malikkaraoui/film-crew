'use client'

import { useEffect, useState } from 'react'
import { ThemeToggle } from './theme-toggle'
import { Badge } from '@/components/ui/badge'

type ProviderStatus = {
  name: string
  type: string
  health: { status: string }
}

type ActiveRun = {
  id: string
  idea: string
  currentStep: number
  costEur: number
  status: string
}

type FailoverEvent = {
  original: string
  fallback: string
  type: string
  reason: string
  timestamp: string
}

const STATUS_COLORS: Record<string, string> = {
  free: 'bg-green-500',
  busy: 'bg-amber-500',
  killing: 'bg-orange-500',
  down: 'bg-red-500',
  degraded: 'bg-amber-600',
}

export function Topbar() {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null)
  const [costAlert, setCostAlert] = useState(false)
  const [failovers, setFailovers] = useState<FailoverEvent[]>([])

  const loadProviders = async () => {
    try {
      const res = await fetch('/api/providers')
      const json = await res.json()
      if (json.data) setProviders(json.data)
    } catch { /* silencieux */ }
  }

  const loadActiveRun = async () => {
    try {
      const res = await fetch('/api/runs/recovery')
      const json = await res.json()
      if (json.data && json.data.status === 'running') {
        setActiveRun(json.data)
        const configRes = await fetch('/api/config')
        const configJson = await configRes.json()
        if (configJson.data) {
          const alertCfg = configJson.data.find((c: { key: string }) => c.key === 'cost_alert_per_run')
          if (alertCfg) {
            const threshold = parseFloat(alertCfg.value) * 0.8
            setCostAlert((json.data.costEur ?? 0) >= threshold)
          }
        }
      } else {
        setActiveRun(null)
        setCostAlert(false)
      }
    } catch { /* silencieux */ }
  }

  const loadFailovers = async () => {
    try {
      const res = await fetch('/api/providers/failovers')
      const json = await res.json()
      if (json.data) setFailovers(json.data)
    } catch { /* silencieux */ }
  }

  useEffect(() => { // eslint-disable-line react-hooks/exhaustive-deps
    void loadProviders()
    void loadActiveRun()
    void loadFailovers()
    const pi = setInterval(() => void loadProviders(), 60_000)
    const ri = setInterval(() => void loadActiveRun(), 3_000)
    const fi = setInterval(() => void loadFailovers(), 5_000)
    return () => { clearInterval(pi); clearInterval(ri); clearInterval(fi) }
  }, [])

  async function dismissFailovers() {
    await fetch('/api/providers/failovers', { method: 'DELETE' })
    setFailovers([])
  }

  return (
    <header className="sticky top-0 z-50 flex flex-col border-b bg-background">
      <div className="flex h-12 items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold">FILM-CREW</span>

          {activeRun && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                Étape {activeRun.currentStep}/8
              </span>
              <span className={`font-mono ${costAlert ? 'text-red-500 animate-pulse font-bold' : 'text-muted-foreground'}`}>
                {(activeRun.costEur ?? 0).toFixed(2)} €
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {providers.map((p) => (
            <div key={p.name} className="flex items-center gap-1" title={`${p.name} — ${p.health.status}`}>
              <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[p.health.status] ?? 'bg-gray-400'}`} />
              <span className="text-[10px] text-muted-foreground">{p.name}</span>
            </div>
          ))}
          <ThemeToggle />
        </div>
      </div>

      {failovers.length > 0 && (
        <div className="flex items-center justify-between border-t bg-amber-50 px-4 py-1.5 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
              Failover
            </Badge>
            <span>
              {failovers[0].original} indisponible — basculé sur {failovers[0].fallback}
              {' '}({new Date(failovers[0].timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})
            </span>
            {failovers.length > 1 && (
              <span className="text-amber-600 dark:text-amber-400">
                +{failovers.length - 1} autre{failovers.length > 2 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            onClick={dismissFailovers}
            className="text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
          >
            Fermer
          </button>
        </div>
      )}
    </header>
  )
}
