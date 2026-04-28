import { NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { logger } from '@/lib/logger'

type AudioManifestScene = {
  sceneIndex: number
  mixFilePath?: string
}

type AudioManifest = {
  masterFilePath?: string
  sampleRate?: number
  channels?: number
  scenes?: AudioManifestScene[]
}

function getMimeType(filePath: string): string {
  if (filePath.endsWith('.mp3')) return 'audio/mpeg'
  if (filePath.endsWith('.m4a')) return 'audio/mp4'
  if (filePath.endsWith('.ogg')) return 'audio/ogg'
  return 'audio/wav'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const storagePath = join(process.cwd(), 'storage', 'runs', id)
    const manifestPath = join(storagePath, 'audio', 'audio-master-manifest.json')
    const url = new URL(request.url)
    const sceneIndexParam = url.searchParams.get('sceneIndex')

    let manifest: AudioManifest
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as AudioManifest
    } catch {
      return NextResponse.json(
        { error: { code: 'NO_AUDIO_MANIFEST', message: 'audio-master-manifest.json introuvable' } },
        { status: 404 },
      )
    }

    let filePath = manifest.masterFilePath
    let logContext: Record<string, unknown> = { kind: 'master' }

    if (sceneIndexParam) {
      const sceneIndex = Number.parseInt(sceneIndexParam, 10)
      if (!Number.isFinite(sceneIndex)) {
        return NextResponse.json(
          { error: { code: 'BAD_SCENE_INDEX', message: 'sceneIndex invalide' } },
          { status: 400 },
        )
      }

      const scene = manifest.scenes?.find((entry) => entry.sceneIndex === sceneIndex)
      if (!scene?.mixFilePath) {
        return NextResponse.json(
          { error: { code: 'NO_SCENE_AUDIO', message: `Aucun audio de scène ${sceneIndex} disponible` } },
          { status: 404 },
        )
      }

      filePath = scene.mixFilePath
      logContext = { kind: 'scene', sceneIndex }
    }

    if (!filePath) {
      return NextResponse.json(
        { error: { code: 'NO_AUDIO_FILE', message: 'Aucun fichier audio disponible' } },
        { status: 404 },
      )
    }

    if (!filePath.startsWith(storagePath)) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Chemin audio non autorisé' } },
        { status: 403 },
      )
    }

    let fileInfo: Awaited<ReturnType<typeof stat>>
    try {
      fileInfo = await stat(filePath)
    } catch {
      return NextResponse.json(
        { error: { code: 'AUDIO_FILE_NOT_FOUND', message: 'Fichier audio introuvable sur disque' } },
        { status: 404 },
      )
    }

    const fileSize = fileInfo.size
    const contentType = getMimeType(filePath)
    const rangeHeader = request.headers.get('range')

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      if (match) {
        const start = Number.parseInt(match[1], 10)
        const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1
        const chunkSize = end - start + 1
        const buffer = await readFile(filePath)
        const chunk = buffer.subarray(start, end + 1)

        logger.info({ event: 'audio_served_range', runId: id, ...logContext, start, end, chunkSize, fileSize })
        return new Response(chunk, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
            'Cache-Control': 'no-cache',
          },
        })
      }
    }

    logger.info({ event: 'audio_served', runId: id, ...logContext, fileSize, contentType })
    const buffer = await readFile(filePath)
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'AUDIO_STREAM_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}