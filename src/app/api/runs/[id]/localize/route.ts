import { NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider, TTSProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'
import { SUPPORTED_LANGUAGES } from '@/lib/localization'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { languages } = body as { languages: string[] }

    if (!languages?.length) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Au moins une langue requise' } },
        { status: 400 },
      )
    }

    const storagePath = join(process.cwd(), 'storage', 'runs', id)
    let structure: { scenes: { dialogue: string }[] }
    try {
      const raw = await readFile(join(storagePath, 'structure.json'), 'utf-8')
      structure = JSON.parse(raw)
    } catch {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'structure.json introuvable — le run doit être terminé' } },
        { status: 404 },
      )
    }

    const narration = structure.scenes.map((s) => s.dialogue).filter(Boolean).join('\n\n')
    const results: { lang: string; status: string; costEur: number }[] = []
    let totalCost = 0

    for (const langCode of languages) {
      const lang = SUPPORTED_LANGUAGES.find((l) => l.code === langCode)
      if (!lang) continue

      const langDir = join(storagePath, 'final', langCode)
      await mkdir(langDir, { recursive: true })

      try {
        // 1. Traduire via LLM
        const { result: translation } = await executeWithFailover(
          'llm',
          async (p) => {
            const llm = p as LLMProvider
            return llm.chat(
              [
                {
                  role: 'system',
                  content: `Tu es un traducteur professionnel. Traduis le script de narration en ${lang.label}. Garde le ton, le rythme et les inflexions. Retourne UNIQUEMENT le texte traduit.`,
                },
                { role: 'user', content: narration },
              ],
              { temperature: 0.3 },
            )
          },
          id,
        )

        await writeFile(join(langDir, 'script.txt'), translation.content)
        totalCost += translation.costEur

        // 2. TTS dans la langue cible
        try {
          const { result: audio } = await executeWithFailover(
            'tts',
            async (p) => {
              const tts = p as TTSProvider
              return tts.synthesize(translation.content, 'default', langCode)
            },
            id,
          )
          totalCost += audio.costEur
        } catch (e) {
          logger.warn({ event: 'localize_tts_failed', runId: id, lang: langCode, error: (e as Error).message })
        }

        results.push({ lang: langCode, status: 'completed', costEur: translation.costEur })
      } catch (e) {
        logger.error({ event: 'localize_failed', runId: id, lang: langCode, error: (e as Error).message })
        results.push({ lang: langCode, status: 'failed', costEur: 0 })
      }
    }

    return NextResponse.json({ data: { results, totalCost } })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'LOCALIZE_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
