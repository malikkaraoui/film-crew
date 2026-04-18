import { NextResponse } from 'next/server'
import { registry } from '@/lib/providers/registry'
import { bootstrapProviders } from '@/lib/providers/bootstrap'
bootstrapProviders()

export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params
    const providers = registry.getByType('llm')
      .concat(registry.getByType('video'))
      .concat(registry.getByType('tts'))
      .concat(registry.getByType('image'))
      .concat(registry.getByType('stock'))

    const provider = providers.find((p) => p.name === name)
    if (!provider) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `Provider "${name}" introuvable` } },
        { status: 404 }
      )
    }

    const health = await provider.healthCheck()
    return NextResponse.json({ data: { name, health } })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'PROVIDER_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
