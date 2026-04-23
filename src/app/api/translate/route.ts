import { NextResponse } from 'next/server'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import { isCloudLlmReachable, resolveLlmTarget } from '@/lib/llm/target'

const LANGUAGE_LABELS = {
  fr: 'français',
  en: 'anglais',
} as const

type SupportedLanguage = keyof typeof LANGUAGE_LABELS

type TranslateBody = {
  text?: string
  from?: SupportedLanguage
  to?: SupportedLanguage
  mode?: 'local' | 'cloud'
  purpose?: 'prompt-review' | 'generic'
}

type TranslationResponse = {
  text: string
  provider: string
  mode: 'local' | 'cloud'
  model: string
}

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === 'fr' || value === 'en'
}

function buildSystemPrompt(from: SupportedLanguage, to: SupportedLanguage, purpose: TranslateBody['purpose']): string {
  const source = LANGUAGE_LABELS[from]
  const target = LANGUAGE_LABELS[to]

  return [
    'Tu es un traducteur expert spécialisé dans les prompts créatifs et audiovisuels.',
    `Traduis fidèlement du ${source} vers ${target}.`,
    purpose === 'prompt-review'
      ? 'Le texte est un prompt de storyboard ou de génération vidéo : tu dois préserver sa valeur opératoire.'
      : 'Le texte peut être technique ou créatif : tu dois préserver précisément le sens.',
    'Contraintes impératives :',
    '- retourne uniquement le texte traduit, sans commentaire, sans markdown, sans guillemets ajoutés ;',
    '- conserve la structure, les sauts de ligne, les listes, les labels de champs et la ponctuation ;',
    '- conserve tels quels les URLs, noms de fichiers, ratios, codes hexadécimaux, nombres, unités et noms de providers/modèles ;',
    '- garde le jargon caméra / lumière / composition s’il est déjà optimal ;',
    '- ne résume pas, ne censure pas, ne "réécris" pas pour faire plus joli ;',
    '- si le texte source contient déjà des segments dans la langue cible, garde-les cohérents dans l’ensemble traduit.',
  ].join('\n')
}

async function runTranslation(
  text: string,
  from: SupportedLanguage,
  to: SupportedLanguage,
  mode: 'local' | 'cloud',
  purpose: TranslateBody['purpose'],
): Promise<TranslationResponse> {
  const llmTarget = resolveLlmTarget(mode)
  const { result, provider } = await executeWithFailover(
    'llm',
    async (currentProvider) => {
      const llm = currentProvider as LLMProvider
      return llm.chat(
        [
          { role: 'system', content: buildSystemPrompt(from, to, purpose) },
          { role: 'user', content: text },
        ],
        {
          temperature: 0.1,
          maxTokens: Math.max(512, Math.min(4096, text.length * 2)),
          model: llmTarget.model,
          host: llmTarget.host,
          headers: llmTarget.headers,
          timeoutMs: 45000,
        },
      )
    },
  )

  return {
    text: result.content.trim(),
    provider: provider.name,
    mode: llmTarget.mode,
    model: llmTarget.model,
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as TranslateBody | null
    const text = body?.text?.trim() ?? ''
    const from = body?.from
    const to = body?.to
    const requestedMode = body?.mode === 'cloud' ? 'cloud' : 'local'
    const purpose = body?.purpose === 'generic' ? 'generic' : 'prompt-review'

    if (!text) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Texte à traduire requis' } },
        { status: 400 },
      )
    }

    if (!isSupportedLanguage(from) || !isSupportedLanguage(to) || from === to) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Langues source/cible invalides' } },
        { status: 400 },
      )
    }

    try {
      const primary = await runTranslation(text, from, to, requestedMode, purpose)
      return NextResponse.json({ data: primary })
    } catch (primaryError) {
      if (requestedMode === 'local' && isCloudLlmReachable()) {
        const fallback = await runTranslation(text, from, to, 'cloud', purpose)
        return NextResponse.json({ data: fallback })
      }

      throw primaryError
    }
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'TRANSLATE_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
