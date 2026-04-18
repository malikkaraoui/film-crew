import { NextResponse } from 'next/server'
import { getChains, createChain } from '@/lib/db/queries/chains'
import { mkdir } from 'fs/promises'
import { join } from 'path'

export async function GET() {
  try {
    const chains = await getChains()
    return NextResponse.json({ data: chains })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, langSource, audience } = body

    if (!name || !langSource) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Nom et langue source requis' } },
        { status: 400 }
      )
    }

    const id = crypto.randomUUID()
    const chain = await createChain({ id, name, langSource, audience })

    // Créer le dossier storage pour le Brand Kit
    const brandPath = join(process.cwd(), 'storage', 'brands', id)
    await mkdir(join(brandPath, 'images'), { recursive: true })

    return NextResponse.json({ data: chain }, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
