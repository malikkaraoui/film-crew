import { INTENTION_BLOCS, type IntentionAnswers } from '@/lib/intention/schema'
import type { StyleTemplate } from '@/lib/templates/loader'

type QuestionDefinition = (typeof INTENTION_BLOCS)[number]['questions'][number]

const QUESTIONS: QuestionDefinition[] = INTENTION_BLOCS.flatMap((bloc) => bloc.questions)

export function normalizeBotToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getQuestionById(id: string): QuestionDefinition | undefined {
  return QUESTIONS.find((question) => question.id === id)
}

export function resolveTemplateId(query: unknown, templates: StyleTemplate[]): string | null {
  if (typeof query !== 'string' || !query.trim()) return null

  const normalizedQuery = normalizeBotToken(query)
  const match = templates.find((template) => {
    return [template.id, template.name, `${template.id} ${template.name}`]
      .map((candidate) => normalizeBotToken(candidate))
      .includes(normalizedQuery)
  })

  return match?.id ?? null
}

export function normalizeQuestionnaireAnswers(input: unknown): {
  answers: IntentionAnswers
  errors: string[]
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { answers: {}, errors: [] }
  }

  const answers: IntentionAnswers = {}
  const errors: string[] = []

  for (const [questionId, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue

    const question = getQuestionById(questionId)
    if (!question) {
      errors.push(`Question inconnue : ${questionId}`)
      continue
    }

    const normalizedValue = normalizeBotToken(rawValue)
    const option = question.options.find((candidate) => {
      return candidate.value === rawValue.trim()
        || normalizeBotToken(candidate.value) === normalizedValue
        || normalizeBotToken(candidate.label) === normalizedValue
    })

    if (!option) {
      errors.push(`Valeur invalide pour ${questionId} : ${rawValue}`)
      continue
    }

    answers[questionId] = option.value
  }

  return { answers, errors }
}