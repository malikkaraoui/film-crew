import { readFile } from 'fs/promises'
import { join, extname } from 'path'
import { NextResponse } from 'next/server'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function isSafeFileName(fileName: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(fileName)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> },
) {
  try {
    const { fileName } = await params
    if (!isSafeFileName(fileName)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Nom de fichier invalide' } },
        { status: 400 },
      )
    }

    const filePath = join(process.cwd(), 'storage', 'reference-images', fileName)
    const buffer = await readFile(filePath)
    const contentType = CONTENT_TYPES[extname(fileName).toLowerCase()] || 'application/octet-stream'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Image introuvable' } },
      { status: 404 },
    )
  }
}
