import { NextResponse } from 'next/server'
import { registry } from '@/lib/providers/registry'
import { SERVICES_METADATA } from '@/lib/providers/metadata'
import { bootstrapProviders } from '@/lib/providers/bootstrap'

bootstrapProviders()

type ServiceHealth = {
  status: 'free' | 'busy' | 'killing' | 'down' | 'degraded'
  lastCheck: string
  details?: string
}

function buildFallbackHealth(details: string): ServiceHealth {
  return {
    status: 'degraded',
    lastCheck: new Date().toISOString(),
    details,
  }
}

export async function GET() {
  try {
    const all = registry.getAllProviders()
    const healthMap = await registry.healthCheckAll()
    const registeredNames = new Set(all.map((p) => p.name.toLowerCase()))

    const providerServices = all.map((p) => {
      const checks = healthMap.get(p.type) ?? []
      const check = checks.find((c) => c.name === p.name)
      const metadata = SERVICES_METADATA[p.name.toLowerCase()]

      return {
        key: p.name,
        name: metadata?.name ?? p.name,
        providerName: p.name,
        type: p.type,
        canTest: true,
        health: check?.health ?? { status: 'down', lastCheck: new Date().toISOString() },
        ...(metadata && {
          category: metadata.category,
          plan: metadata.plan,
          dashboardUrl: metadata.dashboardUrl,
          description: metadata.description,
          notes: metadata.notes,
        }),
      }
    })

    const metadataOnlyServices = Object.entries(SERVICES_METADATA)
      .filter(([key]) => !registeredNames.has(key))
      .map(([key, metadata]) => ({
        key,
        name: metadata.name,
        providerName: key,
        type: metadata.category,
        canTest: false,
        health: buildFallbackHealth('Healthcheck non branché dans le registre providers'),
        category: metadata.category,
        plan: metadata.plan,
        dashboardUrl: metadata.dashboardUrl,
        description: metadata.description,
        notes: metadata.notes,
      }))

    const services = [...providerServices, ...metadataOnlyServices]

    const categoryOrder = ['generation', 'tts', 'stock', 'local', 'oauth', 'other'] as const

    const grouped = services.reduce(
      (acc, s) => {
        const cat = s.category ?? 'other'
        if (!acc[cat]) acc[cat] = []
        acc[cat].push(s)
        return acc
      },
      {} as Record<string, typeof services>
    )

    for (const category of Object.keys(grouped)) {
      grouped[category].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    }

    const orderedGrouped = categoryOrder.reduce((acc, category) => {
      if (grouped[category]?.length) acc[category] = grouped[category]
      return acc
    }, {} as Record<string, typeof services>)

    for (const [category, entries] of Object.entries(grouped)) {
      if (!(category in orderedGrouped)) {
        orderedGrouped[category] = entries
      }
    }

    return NextResponse.json({ data: services, grouped: orderedGrouped })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'SERVICE_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
