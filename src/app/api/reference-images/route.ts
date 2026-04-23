import { mkdir, writeFile } from 'fs/promises'
import { join, extname } from 'path'
import { NextResponse } from 'next/server'

const ALLOWED_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
])
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Fichier image requis' } },
        { status: 400 },
      )
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Formats autorisés : PNG, JPG, WEBP' } },
        { status: 400 },
      )
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Image trop lourde (max 10 MB)' } },
        { status: 400 },
      )
    }

    const extension = ALLOWED_TYPES.get(file.type) || extname(file.name) || '.bin'
    const fileName = `${crypto.randomUUID()}${extension}`
    const storageDir = join(process.cwd(), 'storage', 'reference-images')
    const filePath = join(storageDir, fileName)

    await mkdir(storageDir, { recursive: true })
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(filePath, buffer)

    const origin = new URL(request.url).origin
    const url = `${origin}/api/reference-images/${fileName}`

    return NextResponse.json({
      data: {
        url,
        fileName: file.name,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'REFERENCE_IMAGE_UPLOAD_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
