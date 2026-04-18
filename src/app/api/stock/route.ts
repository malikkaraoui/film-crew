import { NextResponse } from 'next/server'
import { registry } from '@/lib/providers/registry'
import { bootstrapProviders } from '@/lib/providers/bootstrap'
bootstrapProviders()
import type { StockProvider, StockOpts } from '@/lib/providers/types'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const type = (searchParams.get('type') ?? 'image') as StockOpts['type']
    const limit = parseInt(searchParams.get('limit') ?? '10')

    if (!query) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Paramètre "q" requis' } },
        { status: 400 },
      )
    }

    const providers = registry.getByType('stock')
    if (providers.length === 0) {
      return NextResponse.json({ data: { results: [], sources: [] } })
    }

    // Interroger toutes les sources en parallèle
    const results = await Promise.allSettled(
      providers.map(async (p) => {
        const stock = p as StockProvider
        const items = await stock.search(query, { type, limit })
        return items
      }),
    )

    const allResults = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<StockProvider['search']>>> => r.status === 'fulfilled')
      .flatMap((r) => r.value)

    return NextResponse.json({
      data: {
        results: allResults,
        sources: providers.map((p) => p.name),
        count: allResults.length,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'STOCK_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
