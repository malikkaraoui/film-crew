import { NextResponse } from 'next/server'
import { getChainById, updateChain, deleteChain } from '@/lib/db/queries/chains'
import { rm } from 'fs/promises'
import { join } from 'path'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const chain = await getChainById(id)
    if (!chain) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Chaîne introuvable' } },
        { status: 404 }
      )
    }
    return NextResponse.json({ data: chain })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, langSource, audience } = body

    const chain = await updateChain(id, { name, langSource, audience })
    if (!chain) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Chaîne introuvable' } },
        { status: 404 }
      )
    }
    return NextResponse.json({ data: chain })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteChain(id)

    // Supprimer le dossier storage
    const brandPath = join(process.cwd(), 'storage', 'brands', id)
    await rm(brandPath, { recursive: true, force: true })

    return NextResponse.json({ data: { deleted: true } })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
