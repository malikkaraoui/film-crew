import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { updateChain } from '@/lib/db/queries/chains'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const formData = await request.formData()
    const type = formData.get('type') as string // 'image' | 'voice' | 'brand_json' | 'voice_json'

    const brandPath = join(process.cwd(), 'storage', 'brands', id)

    if (type === 'image') {
      const file = formData.get('file') as File
      if (!file) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Fichier requis' } },
          { status: 400 }
        )
      }
      const imagesDir = join(brandPath, 'images')
      await mkdir(imagesDir, { recursive: true })
      const buffer = Buffer.from(await file.arrayBuffer())
      const filePath = join(imagesDir, file.name)
      await writeFile(filePath, buffer)
      return NextResponse.json({ data: { path: filePath, name: file.name } })
    }

    if (type === 'voice') {
      const file = formData.get('file') as File
      if (!file) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Fichier audio requis' } },
          { status: 400 }
        )
      }
      await mkdir(brandPath, { recursive: true })
      const buffer = Buffer.from(await file.arrayBuffer())
      const filePath = join(brandPath, file.name)
      await writeFile(filePath, buffer)

      // Mettre à jour voice.json
      const voiceJson = { voiceFile: file.name }
      await writeFile(join(brandPath, 'voice.json'), JSON.stringify(voiceJson, null, 2))
      return NextResponse.json({ data: { path: filePath, name: file.name } })
    }

    if (type === 'brand_json') {
      const data = formData.get('data') as string
      if (!data) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Données requises' } },
          { status: 400 }
        )
      }
      await mkdir(brandPath, { recursive: true })
      await writeFile(join(brandPath, 'brand.json'), data)
      await updateChain(id, { brandKitPath: join('storage', 'brands', id) })
      return NextResponse.json({ data: { saved: true } })
    }

    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Type invalide : image, voice, ou brand_json' } },
      { status: 400 }
    )
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'UPLOAD_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
