import { NextResponse } from 'next/server'
import { registry } from '@/lib/providers/registry'
import { bootstrapProviders } from '@/lib/providers/bootstrap'

bootstrapProviders()

export async function POST(req: Request) {
  try {
    const { prompt, duration } = await req.json()

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ success: false, message: 'Prompt manquant' }, { status: 400 })
    }

    const providers = registry.getByType('video')
    const sketchLocal = providers.find((p) => p.name === 'sketch-local')

    if (!sketchLocal) {
      return NextResponse.json({ success: false, message: 'Sketch Local provider non trouve' }, { status: 404 })
    }

    const result = await sketchLocal.generate(prompt, { duration: duration || 5 })

    return NextResponse.json({
      success: true,
      message: `Video generee en ${result.duration}s`,
      filePath: result.filePath,
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status: 500 }
    )
  }
}
