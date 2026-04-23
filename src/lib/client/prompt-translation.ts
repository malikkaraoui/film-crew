export type TranslationDirection = {
  from: 'fr' | 'en'
  to: 'fr' | 'en'
}

export type PromptTranslationResult = {
  text: string
  provider: string
  mode: 'local' | 'cloud'
  model: string
}

export async function translatePromptText(
  text: string,
  direction: TranslationDirection,
): Promise<PromptTranslationResult> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      from: direction.from,
      to: direction.to,
      mode: 'local',
      purpose: 'prompt-review',
    }),
  })

  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.error?.message ?? 'Traduction impossible')
  }

  return json.data as PromptTranslationResult
}
