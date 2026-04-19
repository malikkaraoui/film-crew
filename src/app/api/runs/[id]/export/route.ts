import { NextResponse } from 'next/server'
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import { EXPORT_PRESETS } from '@/lib/export/presets'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const metadataPath = join(process.cwd(), 'storage', 'runs', id, 'final', 'metadata.json')

    let metadata: unknown = null
    try {
      metadata = JSON.parse(await readFile(metadataPath, 'utf-8'))
    } catch { /* pas encore de métadonnées */ }

    return NextResponse.json({
      data: {
        presets: EXPORT_PRESETS,
        metadata,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'EXPORT_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body

    if (action === 'regenerate_metadata') {
      // Régénérer les métadonnées via LLM
      const storagePath = join(process.cwd(), 'storage', 'runs', id)
      let structure: { title?: string; scenes?: { description: string }[] }
      try {
        structure = JSON.parse(await readFile(join(storagePath, 'structure.json'), 'utf-8'))
      } catch {
        structure = { title: 'Vidéo FILM-CREW' }
      }

      const { result } = await executeWithFailover(
        'llm',
        async (p) => {
          const llm = p as LLMProvider
          return llm.chat(
            [
              {
                role: 'system',
                content: `Tu génères des métadonnées pour une vidéo courte destinée aux réseaux sociaux. Retourne un JSON :
{
  "description": "description accrocheuse (2-3 phrases)",
  "hashtags": ["#tag1", "#tag2", ...],
  "title_variants": { "tiktok": "...", "youtube": "...", "instagram": "..." }
}
Retourne UNIQUEMENT le JSON.`,
              },
              {
                role: 'user',
                content: `Titre : ${structure.title}\nScènes : ${structure.scenes?.map((s) => s.description).join(', ')}`,
              },
            ],
            { temperature: 0.8 },
          )
        },
        id,
      )

      let metadata: unknown
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/)
        metadata = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(result.content)
      } catch {
        metadata = { description: result.content, hashtags: [], title_variants: {} }
      }

      await writeFile(
        join(storagePath, 'final', 'metadata.json'),
        JSON.stringify(metadata, null, 2),
      )

      return NextResponse.json({ data: metadata })
    }

    if (action === 'download_artifacts') {
      const storagePath = join(process.cwd(), 'storage', 'runs', id)

      // Collecter les artefacts réels
      const artifacts: { name: string; content: string }[] = []
      const textFiles = ['brief.json', 'structure.json', 'structure-raw.txt', 'prompts.json', 'generation-manifest.json', 'preview-manifest.json']
      for (const name of textFiles) {
        try {
          artifacts.push({ name, content: await readFile(join(storagePath, name), 'utf-8') })
        } catch { /* absent */ }
      }
      // Métadonnées
      try {
        artifacts.push({ name: 'final/metadata.json', content: await readFile(join(storagePath, 'final', 'metadata.json'), 'utf-8') })
      } catch { /* absent */ }
      // Storyboard manifest
      try {
        artifacts.push({ name: 'storyboard/manifest.json', content: await readFile(join(storagePath, 'storyboard', 'manifest.json'), 'utf-8') })
      } catch { /* absent */ }

      // Lister les images storyboard
      let imageFiles: string[] = []
      try {
        const files = await readdir(join(storagePath, 'storyboard'))
        imageFiles = files.filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
      } catch { /* absent */ }

      return NextResponse.json({
        data: {
          artifacts: artifacts.map(a => ({ name: a.name, sizeBytes: Buffer.byteLength(a.content) })),
          storyboardImages: imageFiles,
          summary: `${artifacts.length} fichiers texte/JSON + ${imageFiles.length} images storyboard`,
        },
      })
    }

    return NextResponse.json(
      { error: { code: 'UNKNOWN_ACTION', message: `Action "${action}" inconnue` } },
      { status: 400 },
    )
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'EXPORT_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
