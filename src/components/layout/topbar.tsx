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

  useEffect(() => {
    loadProviders()
    loadActiveRun()
    const pi = setInterval(loadProviders, 60_000)
    const ri = setInterval(loadActiveRun, 3_000)
    return () => { clearInterval(pi); clearInterval(ri) }
  }, [])

  async function loadProviders() {
    try {
      const res = await fetch('/api/providers')
      const json = await res.json()
      if (json.data) setProviders(json.data)
    } catch { /* silencieux */ }
  }

  async function loadActiveRun() {
    try {
      const res = await fetch('/api/runs/recovery')
      const json = await res.json()
      if (json.data && json.data.status === 'running') {
        setActiveRun(json.data)
        // Vérifier le seuil d'alerte
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

  return (
    <header className="sticky top-0 z-50 flex h-12 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-semibold">VIDEO_TIKTOK</span>

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
    </header>
  )
}
