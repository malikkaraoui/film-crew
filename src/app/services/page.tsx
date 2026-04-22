'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ExternalLink, RefreshCw } from 'lucide-react'

type ServiceInfo = {
  key: string
  name: string
  providerName: string
  type: string
  canTest: boolean
  health: {
    status: 'free' | 'busy' | 'killing' | 'down' | 'degraded'
    lastCheck: string
    details?: string
  }
  category?: 'generation' | 'tts' | 'stock' | 'local' | 'oauth'
  plan?: 'paid' | 'free' | 'local' | 'oauth'
  status?: 'active' | 'disabled' | 'draft'
  dashboardUrl?: string
  description?: string
  notes?: string
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  free: { label: 'Libre', variant: 'default' },
  busy: { label: 'Occupé', variant: 'secondary' },
  killing: { label: 'Arrêt en cours', variant: 'secondary' },
  down: { label: 'Indisponible', variant: 'destructive' },
  degraded: { label: 'Dégradé', variant: 'outline' },
}

const SERVICE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: '✅', color: 'text-green-600' },
  disabled: { label: '🔒', color: 'text-gray-400' },
  draft: { label: '📋', color: 'text-amber-600' },
}

const CATEGORY_TYPE: Record<string, 'video' | 'audio' | 'other'> = {
  generation: 'video',
  tts: 'audio',
  stock: 'other',
  local: 'other',
  oauth: 'other',
}

type TestState = { status: 'idle' } | { status: 'testing' } | { status: 'done'; result: string; ok: boolean }

export default function ServicesPage() {
  const [grouped, setGrouped] = useState<Record<string, ServiceInfo[]>>({})
  const [loading, setLoading] = useState(true)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [refreshing, setRefreshing] = useState(false)

  async function loadServices() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/services')
      const json = await res.json()
      if (json.grouped) setGrouped(json.grouped)
      setLoading(false)
    } catch (e) {
      console.error('Erreur chargement services:', e)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadServices()
    const interval = setInterval(() => void loadServices(), 60_000)
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
      void loadServices()
    } catch (e) {
      setTestStates(prev => ({ ...prev, [name]: { status: 'done', result: (e as Error).message, ok: false } }))
    }
    setTimeout(() => setTestStates(prev => ({ ...prev, [name]: { status: 'idle' } })), 5000)
  }

  // Grouper par TYPE (VIDEO/AUDIO) puis LOCAL/CLOUD
  const servicesByType = Object.values(grouped).flat().reduce(
    (acc, svc) => {
      const type = CATEGORY_TYPE[svc.category ?? 'local'] ?? 'other'
      if (!acc[type]) acc[type] = { local: [], cloud: [] }

      if (svc.plan === 'local') {
        acc[type].local.push(svc)
      } else {
        acc[type].cloud.push(svc)
      }
      return acc
    },
    {} as Record<string, { local: ServiceInfo[]; cloud: ServiceInfo[] }>
  )

  // Trier cloud par status (active > draft > disabled)
  const sortByStatus = (services: ServiceInfo[]) => {
    return services.sort((a, b) => {
      const statusOrder = { active: 0, draft: 1, disabled: 2 }
      return (statusOrder[a.status ?? 'active'] ?? 3) - (statusOrder[b.status ?? 'active'] ?? 3)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">🎬 Services</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadServices()}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Rafraîchissement...' : 'Rafraîchir'}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground animate-pulse">Chargement...</p>
      ) : !Object.keys(servicesByType).length ? (
        <p className="text-sm text-muted-foreground">Aucun service.</p>
      ) : (
        <div className="space-y-8">
          {/* 🎬 VIDEO */}
          {servicesByType.video && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-6 space-y-4">
              <h2 className="text-lg font-bold text-foreground">🎬 VIDEO</h2>

              {/* Cloud Video */}
              {servicesByType.video.cloud.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Cloud</h3>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {sortByStatus(servicesByType.video.cloud).map((service) => (
                      <ServiceCard
                        key={service.key}
                        service={service}
                        statusInfo={STATUS_LABELS[service.health.status] ?? STATUS_LABELS.down}
                        testState={testStates[service.key] ?? { status: 'idle' }}
                        onTest={() => handleTest(service.providerName)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Local Video */}
              {servicesByType.video.local.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Local</h3>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {servicesByType.video.local.map((service) => (
                      <ServiceCard
                        key={service.key}
                        service={service}
                        statusInfo={STATUS_LABELS[service.health.status] ?? STATUS_LABELS.down}
                        testState={testStates[service.key] ?? { status: 'idle' }}
                        onTest={() => handleTest(service.providerName)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 🎤 AUDIO */}
          {servicesByType.audio && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-6 space-y-4">
              <h2 className="text-lg font-bold text-foreground">🎤 AUDIO</h2>

              {/* Cloud Audio */}
              {servicesByType.audio.cloud.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Cloud</h3>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {sortByStatus(servicesByType.audio.cloud).map((service) => (
                      <ServiceCard
                        key={service.key}
                        service={service}
                        statusInfo={STATUS_LABELS[service.health.status] ?? STATUS_LABELS.down}
                        testState={testStates[service.key] ?? { status: 'idle' }}
                        onTest={() => handleTest(service.providerName)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Local Audio */}
              {servicesByType.audio.local.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Local</h3>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {servicesByType.audio.local.map((service) => (
                      <ServiceCard
                        key={service.key}
                        service={service}
                        statusInfo={STATUS_LABELS[service.health.status] ?? STATUS_LABELS.down}
                        testState={testStates[service.key] ?? { status: 'idle' }}
                        onTest={() => handleTest(service.providerName)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ServiceCard({
  service,
  statusInfo,
  testState: ts,
  onTest,
}: {
  service: ServiceInfo
  statusInfo: { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  testState: TestState
  onTest: () => void
}) {
  const svcStatus = SERVICE_STATUS_LABELS[service.status ?? 'active']
  const isDisabled = service.status === 'disabled'

  return (
    <Card className={`flex flex-col overflow-hidden ${isDisabled ? 'opacity-50' : ''}`}>
      <CardHeader className="pb-2">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 mb-0.5">
                <CardTitle className="text-sm font-semibold truncate">{service.name}</CardTitle>
                <span className={`text-lg leading-none ${svcStatus.color}`} title={service.status}>
                  {svcStatus.label}
                </span>
              </div>
            </div>
          </div>

          {service.description && !isDisabled && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {service.description}
            </p>
          )}
        </div>
      </CardHeader>

      <div className="flex gap-2 px-4 pb-3 mt-auto">
        {service.dashboardUrl && (
          <a
            href={service.dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs hover:bg-accent rounded transition-colors border border-input"
          >
            <ExternalLink className="h-3 w-3" />
            <span className="hidden sm:inline">Open</span>
          </a>
        )}

        {!isDisabled && service.canTest ? (
          ts.status === 'testing' ? (
            <Button variant="ghost" size="sm" disabled className="flex-1 text-xs animate-pulse">
              Testing...
            </Button>
          ) : ts.status === 'done' ? (
            <span
              className={`flex-1 text-xs font-medium px-2 py-1 rounded text-center ${
                ts.ok
                  ? 'text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                  : 'text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-400'
              }`}
            >
              {ts.ok ? '✅' : '❌'}
            </span>
          ) : (
            <Button variant="ghost" size="sm" className="flex-1 text-xs gap-1" onClick={onTest}>
              <RefreshCw className="h-3 w-3" />
              Test
            </Button>
          )
        ) : (
          <span className="flex-1 text-xs font-medium px-2 py-1 rounded text-center text-muted-foreground bg-muted">
            {isDisabled ? '—' : 'N/A'}
          </span>
        )}
      </div>
    </Card>
  )
}
