import { NextResponse } from 'next/server'
import { registry } from '@/lib/providers/registry'
import { bootstrapProviders } from '@/lib/providers/bootstrap'
bootstrapProviders()

export async function GET() {
  try {
    const all = registry.getAllProviders()
    const healthMap = await registry.healthCheckAll()

    const providers = all.map((p) => {
      const checks = healthMap.get(p.type) ?? []
      const check = checks.find((c) => c.name === p.name)
      return {
        name: p.name,
        type: p.type,
        health: check?.health ?? { status: 'down', lastCheck: new Date().toISOString() },
      }
    })

    return NextResponse.json({ data: providers })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'PROVIDER_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
